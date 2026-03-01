/// <reference types="vite/client" />

declare module '*.wasm?init' {
  const initWasm: (
    imports?: WebAssembly.Imports,
  ) => Promise<WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource>;
  // biome-ignore lint/style/noDefaultExport: Vite wasm ?init loaders are consumed via default import.
  export default initWasm;
}

declare module 'process/browser' {
  const browserProcess: typeof import('process');
  // biome-ignore lint/style/noDefaultExport: process/browser is consumed via default import shim.
  export default browserProcess;
}
