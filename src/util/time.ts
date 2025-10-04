export const delay = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
