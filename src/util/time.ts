export const delay = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
