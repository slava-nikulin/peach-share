import type { RoomSession, ICECfg } from "../state/sessionStore";
import { sessionStore } from "../state/sessionStore";
import { getOrCreatePeerId } from "./id";

/** Параметры создания сессии */
export type CreateSessionOpts = {
  roomId: string;                 // идентификатор комнаты (строка/код)
  signalingUrl: string;           // ws://... URL сигналинга (только обмен SDP/ICE)
  iceServers: ICECfg;             // ICE сервера: STUN (сейчас) и/или TURN (позже)
};

/** Создаёт объект сессии комнаты и регистрирует его в store.
 *  Важные части:
 *  - peerId: стабильный для (браузер×комната), чтобы вкладки одной комнаты синхронизировались
 *  - ws: WebSocket для сигналинга (пересылка offer/answer/candidate)
 *  - peers/dcs: карты активных RTCPeerConnection и DataChannel по peerId собеседника
 *  - bc: BroadcastChannel для синхронизации вкладок одной комнаты (файлы/метаданные/UX)
 */
export function createRoomSession(opts: CreateSessionOpts): RoomSession {
  const peerId = getOrCreatePeerId(opts.roomId);

  const session: RoomSession = {
    roomId: opts.roomId,
    peerId,
    signalingUrl: opts.signalingUrl,
    iceServers: opts.iceServers,
    peers: new Map(),
    dcs: new Map(),
    bc: new BroadcastChannel(`peachshare:${opts.roomId}`),

    /** Подключение к сигналингу и вступление в комнату.
     *  Что происходит:
     *  1) Открываем WS -> отправляем {type:'join', roomId, peerId}
     *  2) Получаем список пиров -> для каждого создаём RTCPeerConnection
     *     Параметр RTCConfiguration: { iceServers }
     *     - iceServers: массив объектов вида:
     *        { urls: 'stun:stun.l.google.com:19302' }
     *        { urls: 'turn:turn.example.com', username, credential } // позже
     *  3) Инициатор пары вызывает createOffer/setLocalDescription и шлёт SDP в сигналинг
     *  4) Ответчик setRemoteDescription -> createAnswer -> setLocalDescription -> отправляет SDP answer
     *  5) По мере ICE-кандидатов -> addIceCandidate
     */
    async connect() {
      const ws = new WebSocket(opts.signalingUrl);
      session.ws = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "join", roomId: opts.roomId, peerId }));
      };

      ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case "peers": {
            // Список активных peerId в комнате (кроме нас)
            for (const otherId of msg.peers as string[]) {
              await ensurePeerConnection(otherId, /*asOfferer*/ true);
            }
            break;
          }
          case "peer-joined": {
            const otherId = msg.peerId as string;
            if (otherId !== peerId) await ensurePeerConnection(otherId, true);
            break;
          }
          case "offer": {
            const from = msg.from as string;
            const pc = await ensurePeerConnection(from, /*asOfferer*/ false);
            await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: "answer", to: from, from: peerId, sdp: answer.sdp }));
            break;
          }
          case "answer": {
            const from = msg.from as string;
            const pc = session.peers.get(from);
            if (pc && !pc.remoteDescription) {
              await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
            }
            break;
          }
          case "candidate": {
            const from = msg.from as string;
            const pc = session.peers.get(from);
            if (pc && msg.candidate) {
              try { await pc.addIceCandidate(msg.candidate); } catch {}
            }
            break;
          }
          case "peer-left": {
            const leftId = msg.peerId as string;
            destroyPeer(leftId);
            break;
          }
        }
      };

      ws.onclose = () => { /* можно авто-reconnect по желанию */ };
      ws.onerror = () => { /* noop для прототипа */ };
    },

    /** Отключение от сигналинга и разрыв всех P2P */
    disconnect() {
      session.ws?.close();
      session.ws = undefined;
      for (const id of session.peers.keys()) destroyPeer(id);
      session.bc?.close();
    },
  };

  session.bc!.onmessage = (ev) => {
    // Пример: синхронизация добавления/удаления файла между вкладками одной комнаты
    // { type: 'announce-file', fileId, meta } / { type: 'revoke-file', fileId }
    // Здесь просто заглушка: в реальной логике — обновление общего UI-стора.
    // console.log("[BC]", ev.data);
  };

  sessionStore.set(opts.roomId, session);
  return session;

  /** Создаёт или возвращает RTCPeerConnection к peer otherId */
  async function ensurePeerConnection(otherId: string, asOfferer: boolean): Promise<RTCPeerConnection> {
    let pc = session.peers.get(otherId);
    if (pc) return pc;

    // RTCConfiguration: объяснение ключевых параметров
    // - iceServers: список STUN/TURN серверов, помогает NAT-пробросу
    // - iceTransportPolicy (опц.): 'all' или 'relay'; по умолчанию 'all'
    pc = new RTCPeerConnection({ iceServers: session.iceServers });
    session.peers.set(otherId, pc);

    // DataChannel:
    // Для инициатора пары открываем канал; ответчик получит его в ondatachannel.
    if (asOfferer) {
      const dc = pc.createDataChannel("data", { ordered: true });
      session.dcs.set(otherId, dc);
      wireDC(otherId, dc);
    } else {
      pc.ondatachannel = (ev) => {
        session.dcs.set(otherId, ev.channel);
        wireDC(otherId, ev.channel);
      };
    }

    // ICE кандидаты: отправляем в сигналинг
    pc.onicecandidate = (e) => {
      if (e.candidate && session.ws?.readyState === 1) {
        session.ws.send(JSON.stringify({ type: "candidate", to: otherId, from: peerId, candidate: e.candidate }));
      }
    };

    // Статусы соединения (полезно для UI)
    pc.onconnectionstatechange = () => {
      // console.debug("pc", otherId, pc!.connectionState);
    };

    if (asOfferer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      session.ws?.send(JSON.stringify({ type: "offer", to: otherId, from: peerId, sdp: offer.sdp }));
    }
    return pc;
  }

  function wireDC(otherId: string, dc: RTCDataChannel) {
    // Дуплексный канал. Здесь позже повесим протокол файлов: announce/request/chunk/eof/revoke
    dc.onopen = () => { /* готов к обмену */ };
    dc.onclose = () => { /* очистка */ };
    dc.onmessage = (e) => {
      // Пример: пробрасываем сообщение во все вкладки этой комнаты
      session.bc?.postMessage({ from: otherId, payload: e.data });
    };
  }

  function destroyPeer(otherId: string) {
    const dc = session.dcs.get(otherId);
    if (dc) { try { dc.close(); } catch {} session.dcs.delete(otherId); }
    const pc = session.peers.get(otherId);
    if (pc) { try { pc.close(); } catch {} session.peers.delete(otherId); }
  }
}
