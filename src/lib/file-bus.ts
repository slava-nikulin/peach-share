import type { RtcEndpoint } from './webrtc';

export interface FileBus {
  sendJSON: (m: unknown) => void;
  sendBinary: (b: ArrayBuffer | Uint8Array) => void;
  onJSON: (h: (m: unknown) => void) => () => void;
  onBinary: (h: (b: ArrayBuffer) => void) => () => void;
  close: () => void;
}

export function toFileBus(ep: RtcEndpoint): FileBus {
  return {
    sendJSON: ep.sendJSON,
    sendBinary: ep.sendBinary,
    onJSON: ep.onJSON,
    onBinary: ep.onBinary,
    close: ep.close,
  };
}
