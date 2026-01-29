// src/adapters/kdf/argon2id.node.ts
import fs from 'node:fs';
import path from 'node:path';
import setupWasm from 'argon2id/lib/setup.js';
import type { RoomIdKdfPort } from '../../bll/ports/room-id-kdf';

type Argon2idFn = (params: {
  password: Uint8Array;
  salt: Uint8Array;
  parallelism: number;
  passes: number;
  memorySize: number; // KiB
  tagLength: number; // bytes
  ad?: Uint8Array;
  secret?: Uint8Array;
}) => Uint8Array;

function resolveFromPkg(rel: string) {
  // Устойчиво для pnpm: находим реальную папку пакета через package.json. [web:90]
  return path.join(path.dirname(require.resolve('argon2id/package.json')), rel);
}

export class Argon2idNodeRoomIdKdf implements RoomIdKdfPort {
  private readonly argon2idPromise: Promise<Argon2idFn>;

  constructor() {
    const simd = resolveFromPkg('dist/simd.wasm');
    const nosimd = resolveFromPkg('dist/no-simd.wasm');

    // Node-инициализация через setupWasm рекомендована в README. [web:90]
    this.argon2idPromise = setupWasm(
      (importObject) => WebAssembly.instantiate(fs.readFileSync(simd), importObject),
      (importObject) => WebAssembly.instantiate(fs.readFileSync(nosimd), importObject),
    ) as Promise<Argon2idFn>;
  }

  async deriveRoomId(prs: string, drandSalt: Uint8Array): Promise<Uint8Array> {
    const argon2id = await this.argon2idPromise;

    const out = argon2id({
      password: new TextEncoder().encode(prs),
      salt: drandSalt,
      parallelism: 1,
      passes: 3,
      memorySize: 64 * 1024, // KiB
      tagLength: 32, // bytes
    });

    return out;
  }
}
