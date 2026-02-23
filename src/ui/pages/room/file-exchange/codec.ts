import { type ControlMsg, isControlMsg } from './protocol';

const te = new TextEncoder();
const td = new TextDecoder();

export type Codec = {
  encodeControl(msg: ControlMsg): Uint8Array;
  decodeControl(bytes: Uint8Array): ControlMsg;
};

export function createJsonCodec(opts: { maxBytes: number }): Codec {
  const { maxBytes } = opts;

  return {
    encodeControl(msg: ControlMsg): Uint8Array {
      const json = JSON.stringify(msg);
      const out = te.encode(json);
      if (out.length > maxBytes) {
        throw new Error(`CONTROL message exceeds maxBytes=${maxBytes} (got ${out.length})`);
      }
      return out;
    },

    decodeControl(bytes: Uint8Array): ControlMsg {
      if (bytes.length > maxBytes) {
        throw new Error(`CONTROL bytes exceed maxBytes=${maxBytes} (got ${bytes.length})`);
      }
      const json = td.decode(bytes);
      const obj = JSON.parse(json);
      if (!isControlMsg(obj)) throw new Error('Invalid CONTROL message shape');
      return obj;
    },
  };
}
