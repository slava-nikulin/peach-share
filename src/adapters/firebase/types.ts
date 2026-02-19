import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Database } from 'firebase/database';

export type FirebaseAppInit = {
  /** Чтобы тесты не залипали на единственном default app со старым конфигом */
  name: string;
  options: FirebaseOptions;
};

export type FirebaseRtdbConnection = {
  app: FirebaseApp;
  auth: Auth;
  db: Database;
};

export type ProdRtdbConfig = {
  app: FirebaseAppInit;

  /**
   * Если хочешь AppCheck — передай.
   * Если не хочешь — undefined, адаптер вообще не думает, "надо/не надо".
   */
  appCheck?: {
    siteKey: string;
    /**
     * Если передан, выставим глобальную переменную для debug token.
     * Composition решает, когда это уместно (например, только в dev).
     */
    debugToken?: string | boolean;
  };
};

export type EmulatorRtdbConfig = {
  app: FirebaseAppInit;

  emulator: {
    host: string;
    authPort: number;
    rtdbPort: number;

    /** Например "demo" или projectId */
    namespace: string;

    /** 'http:' | 'https:' — composition решает, откуда взять */
    protocol: 'http:' | 'https:';

    /** Твой хак для https-страницы + эмулятор */
    forceSecureRepo?: boolean;

    /** Иногда полезно для устранения залипаний на старых origin/namespace */
    // pruneFirebaseLocalStorage?: boolean;
  };
};
