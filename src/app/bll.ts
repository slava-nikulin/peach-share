import type { Bll } from './composition-root';
import { compose } from './composition-root';

let bllPromise: Promise<Bll> | undefined;

export function getBll(): Promise<Bll> {
  if (!bllPromise) {
    bllPromise = compose()
      .then((s) => s.bll)
      .catch((e) => {
        // retry semantics: если compose упал, следующий вызов попробует снова
        bllPromise = undefined;
        throw e;
      });
  }
  return bllPromise;
}
