import setupWasm from 'argon2id/lib/setup.js';
import wasmSIMD from 'argon2id/dist/simd.wasm?init';
import wasmNonSIMD from 'argon2id/dist/no-simd.wasm?init';

type WasmInitResult = WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource;

const asInstantiatedSource = async (
  init: (imports?: WebAssembly.Imports) => Promise<WasmInitResult>,
  importObject: WebAssembly.Imports,
): Promise<WebAssembly.WebAssemblyInstantiatedSource> => {
  const result = await init(importObject);
  if (result && 'instance' in result) return result;
  return { instance: result };
};

const loadWasm = async () =>
  setupWasm(
    (importObject) => asInstantiatedSource(wasmSIMD, importObject),
    (importObject) => asInstantiatedSource(wasmNonSIMD, importObject),
  );

export default loadWasm;
