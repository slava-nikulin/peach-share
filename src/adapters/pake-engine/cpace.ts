// src/adapters/pake/cpace-engine.ts
import {
  CPaceSession,
  G_X25519,
  sha512,
  type CPaceMessage,
  type CPaceMode,
  type CPaceRole,
} from 'cpace-ts';
import type { PakePort, PakeRole, PakeSessionId } from '../../bll/ports/pake';

export class CpaceEngine implements PakePort {
  private readonly sessions = new Map<PakeSessionId, CPaceSession>();

  newSession(role: PakeRole, prs: Uint8Array): PakeSessionId {
    const suite = {
      name: 'CPACE-X25519-SHA512',
      group: G_X25519,
      hash: sha512,
    } as const;

    const mode: CPaceMode = 'initiator-responder';

    const s = new CPaceSession({
      prs,
      suite,
      mode,
      role: role as CPaceRole,
      // ci/sid/ada/adb пока не задаём (как в твоём тесте)
    });

    const id = this.genId();
    this.sessions.set(id, s);
    return id;
  }

  async start(sessionId: PakeSessionId): Promise<Uint8Array> {
    const s = this.must(sessionId);
    const msg = await s.start();
    if (!msg) throw new Error('CPaceSession.start() returned null/undefined');
    this.assertMsg(msg, 'start');
    return msg.payload;
  }

  async receive(sessionId: PakeSessionId, payload: Uint8Array): Promise<Uint8Array> {
    const s = this.must(sessionId);
    const inbound: CPaceMessage = { type: 'msg', payload };
    const out = await s.receive(inbound);
    if (!out) return new Uint8Array(); // initiator final receive => empty
    this.assertMsg(out, 'receive');
    return out.payload;
  }

  exportISK(sessionId: PakeSessionId): Uint8Array {
    const s = this.must(sessionId);
    return s.exportISK();
  }

  destroy(sessionId: PakeSessionId): void {
    this.sessions.delete(sessionId);
  }

  private must(id: PakeSessionId): CPaceSession {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Unknown or destroyed PAKE session: ${id}`);
    return s;
  }

  private genId(): string {
    // достаточно для in-memory; можно заменить на crypto.randomUUID() если доступно
    return `ps_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }

  private assertMsg(msg: CPaceMessage, where: string): void {
    if (msg.type !== 'msg') throw new Error(`Unexpected CPaceMessage.type in ${where}`);
    if (!(msg.payload instanceof Uint8Array))
      throw new Error(`Unexpected payload type in ${where}`);
  }
}
