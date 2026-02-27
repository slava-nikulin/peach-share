import wasmNonSIMD from 'argon2id/dist/no-simd.wasm?init';
import wasmSIMD from 'argon2id/dist/simd.wasm?init';
import setupWasm from 'argon2id/lib/setup.js';

type WasmInitResult = WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource;

const asInstantiatedSource = async (
  init: (imports?: WebAssembly.Imports) => Promise<WasmInitResult>,
  importObject: WebAssembly.Imports,
): Promise<WebAssembly.WebAssemblyInstantiatedSource> => {
  const result = await init(importObject);
  if (result && 'instance' in result) return result as WebAssembly.WebAssemblyInstantiatedSource;
  return { instance: result } as WebAssembly.WebAssemblyInstantiatedSource;
};

export const loadWasm = async (): ReturnType<typeof setupWasm> =>
  setupWasm(
    (importObject) => asInstantiatedSource(wasmSIMD, importObject),
    (importObject) => asInstantiatedSource(wasmNonSIMD, importObject),
  );
