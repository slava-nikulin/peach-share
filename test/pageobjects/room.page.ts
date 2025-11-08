import type { ChainablePromiseElement } from 'webdriverio';
import { Page } from './page';

type NavigatorClipboard = {
  writeText?: (text: string) => Promise<void> | void;
} & Record<string, unknown>;

type NavigatorLike = {
  clipboard?: NavigatorClipboard;
} & Record<string, unknown>;

interface TokenList {
  add?: (value: string) => void;
  remove?: (value: string) => void;
}

interface StyleLike {
  display?: string;
  removeProperty?: (property: string) => void;
}

interface ElementLike {
  classList?: TokenList;
  removeAttribute?: (attribute: string) => void;
  style?: StyleLike;
  dispatchEvent?: (event: unknown) => void;
}

interface DocumentLike {
  querySelector?: (selector: string) => ElementLike | null;
  addEventListener?: (type: string, listener: (event: unknown) => void, options?: unknown) => void;
  createEvent?: (type: string) => Record<string, unknown> & {
    initEvent?: (type: string, bubbles?: boolean, cancelable?: boolean) => void;
  };
}

interface GlobalShim {
  navigator?: NavigatorLike;
  document?: DocumentLike;
  __copiedText?: string;
  __downloadedFiles?: Array<{ href: string; download: string }>;
  __downloadListener?: (event: unknown) => void;
  Event?: new (type: string, init?: { bubbles?: boolean; cancelable?: boolean }) => unknown;
  CustomEvent?: new (type: string, init?: { bubbles?: boolean; cancelable?: boolean }) => unknown;
}

class RoomPage extends Page {
  private cssEscape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private get secretInput(): ChainablePromiseElement {
    return this.browser.$("//input[@name='secret']");
  }

  private get copySecretButton(): ChainablePromiseElement {
    return this.browser.$("//button[@title='copy']");
  }

  private get fileInput(): ChainablePromiseElement {
    return this.browser.$("[data-testid='room-file-input']");
  }

  private get dropZone(): ChainablePromiseElement {
    return this.browser.$("[data-testid='room-dropzone']");
  }

  private get dropOverlay(): ChainablePromiseElement {
    return this.browser.$("[data-testid='room-drop-overlay']");
  }

  private localFileRow(fileName: string): ChainablePromiseElement {
    const escaped = this.cssEscape(fileName);
    return this.browser.$(`[data-testid="local-file-row"][data-file-name="${escaped}"]`);
  }

  private localRemoveButton(fileName: string): ChainablePromiseElement {
    return this.localFileRow(fileName).$('[data-testid="local-remove-button"]');
  }

  private remoteFileRow(fileName: string): ChainablePromiseElement {
    const escaped = this.cssEscape(fileName);
    return this.browser.$(`[data-testid="remote-file-row"][data-file-name="${escaped}"]`);
  }

  private remoteRequestButton(fileName: string): ChainablePromiseElement {
    return this.remoteFileRow(fileName).$('[data-testid="remote-request-button"]');
  }

  private remoteDownloadLink(fileName: string): ChainablePromiseElement {
    return this.remoteFileRow(fileName).$('[data-testid="remote-download-link"]');
  }

  private get pakeEstablishedBadge(): ChainablePromiseElement {
    return this.browser.$(
      "//div[normalize-space()='PAKE session']/following-sibling::div[1]//span[contains(normalize-space(.),'established')]",
    );
  }

  private get webrtcConnectedBadge(): ChainablePromiseElement {
    return this.browser.$(
      "//div[normalize-space()='WebRTC']/following-sibling::div[1]//span[contains(normalize-space(.),'connected')]",
    );
  }

  private get sasValueLabel(): ChainablePromiseElement {
    return this.browser.$(
      "//div[normalize-space()='SAS']/following-sibling::div[1]//div[contains(@class,'font-mono')]",
    );
  }

  public async waitForLoaded(): Promise<void> {
    await this.secretInput.waitForExist();
  }

  public async stubClipboard(): Promise<void> {
    await this.browser.execute(() => {
      const global = globalThis as unknown as GlobalShim;

      const ensureNavigator = (): NavigatorLike => {
        const candidate: NavigatorLike = global.navigator ?? {};
        if (!global.navigator) {
          try {
            global.navigator = candidate;
          } catch {
            /* navigator may be readonly */
          }
        }
        return candidate;
      };

      const ensureClipboard = (navigatorObj: NavigatorLike): NavigatorClipboard => {
        const clipboard: NavigatorClipboard = navigatorObj.clipboard ?? {};
        if (!navigatorObj.clipboard) {
          try {
            navigatorObj.clipboard = clipboard;
          } catch {
            /* clipboard may be readonly */
          }
        }
        return clipboard;
      };

      const attachWriteText = (
        clipboard: NavigatorClipboard,
        navigatorObj: NavigatorLike,
      ): void => {
        const writeText = async (text: string): Promise<void> => {
          global.__copiedText = text;
        };

        if (clipboard && typeof clipboard === 'object') {
          try {
            clipboard.writeText = writeText;
          } catch {
            Object.defineProperty(clipboard, 'writeText', {
              configurable: true,
              value: writeText,
            });
          }
          return;
        }

        try {
          Object.defineProperty(navigatorObj, 'clipboard', {
            configurable: true,
            value: { writeText } as NavigatorClipboard,
          });
        } catch {
          navigatorObj.clipboard = { writeText };
        }
      };

      const navigatorObj = ensureNavigator();
      const clipboard = ensureClipboard(navigatorObj);
      attachWriteText(clipboard, navigatorObj);
    });
  }

  public async getSecretValue(): Promise<string> {
    return (await this.secretInput.getAttribute('value')) ?? '';
  }

  public async getCopiedSecret(): Promise<string> {
    const copied = (await this.browser.execute(
      () => (globalThis as unknown as GlobalShim).__copiedText ?? '',
    )) as unknown;
    return typeof copied === 'string' ? copied : '';
  }

  public async copySecret(): Promise<void> {
    await this.copySecretButton.waitForClickable();
    await this.copySecretButton.click();
  }

  public async waitForCopyConfirmation(): Promise<void> {
    await this.browser.waitUntil(
      async () => (await this.copySecretButton.getAttribute('aria-pressed')) === 'true',
      { timeout: 4000, interval: 100, timeoutMsg: 'Secret copy confirmation did not appear' },
    );
  }

  public async waitForMetaPanelConnected(): Promise<void> {
    const timeout: number = 20000;

    await this.secretInput.waitForDisplayed({ timeout });
    await this.pakeEstablishedBadge.waitForDisplayed({ timeout });
    await this.webrtcConnectedBadge.waitForDisplayed({ timeout });
    await this.browser.waitUntil(
      async () => ((await this.sasValueLabel.getText()) ?? '').trim().length > 0,
      { timeout, interval: 200, timeoutMsg: 'SAS value did not appear' },
    );
  }

  public async getSasValue(): Promise<string> {
    return (await this.sasValueLabel.getText())?.trim() ?? '';
  }

  public async uploadLocalFile(filePath: string): Promise<void> {
    const remotePath = await this.browser.uploadFile(filePath);
    await this.fileInput.waitForExist();
    const selector = "[data-testid='room-file-input']";
    await this.browser.execute((inputSelector: string) => {
      const global = globalThis as unknown as GlobalShim;
      const node = global.document?.querySelector?.(inputSelector);
      if (!node) return;
      node.classList?.remove?.('hidden');
      node.removeAttribute?.('hidden');
      if (node.style) node.style.display = 'block';
    }, selector);
    await this.fileInput.setValue(remotePath);
    await this.browser.execute((inputSelector: string) => {
      const global = globalThis as unknown as GlobalShim;
      const node = global.document?.querySelector?.(inputSelector);
      if (!node) return;
      node.classList?.add?.('hidden');
      node.style?.removeProperty?.('display');
    }, selector);
  }

  public async waitForLocalFile(fileName: string, timeout: number = 10000): Promise<void> {
    await this.localFileRow(fileName).waitForExist({ timeout });
  }

  public async waitForRemoteFile(fileName: string, timeout: number = 10000): Promise<void> {
    await this.remoteFileRow(fileName).waitForExist({ timeout });
  }

  public async requestRemoteFile(fileName: string): Promise<void> {
    const row = await this.remoteFileRow(fileName);
    await row.waitForExist({ timeout: 10000 });

    const button = await this.remoteRequestButton(fileName);
    if (await button.isExisting()) {
      await button.waitForClickable({ timeout: 10000 });
      await button.click();
    }

    await this.browser.waitUntil(
      async () => {
        const downloading = await row.getAttribute('data-downloading');
        const hasUrl = await row.getAttribute('data-has-url');
        return downloading === '1' || hasUrl === '1';
      },
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: `Remote download did not start for ${fileName}`,
      },
    );
  }

  public async waitForRemoteFileReady(fileName: string, timeout: number = 60000): Promise<void> {
    const row = await this.remoteFileRow(fileName);
    await row.waitForExist({ timeout });
    await this.browser.waitUntil(async () => (await row.getAttribute('data-has-url')) === '1', {
      timeout,
      interval: 500,
      timeoutMsg: `Remote download link not ready for ${fileName}`,
    });
    await this.remoteDownloadLink(fileName).waitForDisplayed({ timeout: 5000 });
  }

  public async getRemoteDownloadHref(fileName: string): Promise<string> {
    return (await this.remoteDownloadLink(fileName).getAttribute('href')) ?? '';
  }

  public async fetchRemoteFileSize(fileName: string): Promise<number> {
    const href = await this.getRemoteDownloadHref(fileName);
    if (!href) return -1;
    const size = (await this.browser.executeAsync((url: string, done: (result: number) => void) => {
      try {
        fetch(url)
          .then((response) => response.arrayBuffer())
          .then((buffer) => done(buffer.byteLength))
          .catch(() => done(-1));
      } catch {
        done(-1);
      }
    }, href)) as unknown;
    return typeof size === 'number' ? size : -1;
  }

  public async clickRemoteDownloadLink(fileName: string): Promise<void> {
    await this.remoteDownloadLink(fileName).click();
  }

  private async dispatchSyntheticDragEvent(
    type: 'dragenter' | 'dragover' | 'dragleave',
  ): Promise<void> {
    await this.dropZone.waitForExist({ timeout: 5000 });
    await this.browser.execute(
      (selector: string, eventType: string) => {
        const globalContext = globalThis as unknown as GlobalShim;
        const target = globalContext.document?.querySelector?.(selector);
        if (!target?.dispatchEvent) return;
        const stubDataTransfer: Record<string, unknown> = {
          dropEffect: 'copy',
          effectAllowed: 'copy',
          files: [],
          items: [],
          types: ['Files'],
          setData: () => {},
          getData: () => '',
          clearData: () => {},
        };
        const EventCtor = globalContext.Event;
        let eventObject: Record<string, unknown> | undefined;
        if (typeof EventCtor === 'function') {
          eventObject = new EventCtor(eventType, {
            bubbles: true,
            cancelable: true,
          }) as unknown as Record<string, unknown>;
        } else {
          const fallback = globalContext.document?.createEvent?.('Event');
          if (fallback) {
            fallback.initEvent?.(eventType, true, true);
            eventObject = fallback;
          } else if (typeof globalContext.CustomEvent === 'function') {
            eventObject = new globalContext.CustomEvent(eventType, {
              bubbles: true,
              cancelable: true,
            }) as unknown as Record<string, unknown>;
          }
        }
        if (!eventObject) return;
        Object.defineProperty(eventObject, 'dataTransfer', {
          value: stubDataTransfer,
          configurable: true,
        });
        target.dispatchEvent(eventObject);
      },
      "[data-testid='room-dropzone']",
      type,
    );
  }

  public async simulateDragEnter(): Promise<void> {
    await this.dispatchSyntheticDragEvent('dragenter');
    await this.dispatchSyntheticDragEvent('dragover');
  }

  public async simulateDragLeave(): Promise<void> {
    await this.dispatchSyntheticDragEvent('dragleave');
  }

  public async waitForDropOverlayVisible(timeout: number = 5000): Promise<void> {
    await this.dropOverlay.waitForDisplayed({ timeout });
  }

  public async waitForDropOverlayHidden(timeout: number = 5000): Promise<void> {
    await this.dropOverlay.waitForExist({ timeout, reverse: true });
  }

  public async stubDownloadCapture(): Promise<void> {
    await this.browser.execute(() => {
      const global = globalThis as unknown as GlobalShim;
      global.__downloadedFiles = [];
      if (global.__downloadListener) return;
      const handler = (event: unknown): void => {
        const target = (event as { target?: { href?: string; download?: string } } | null)?.target;
        if (!target || typeof target.href !== 'string') return;
        const downloads = global.__downloadedFiles ?? [];
        if (!global.__downloadedFiles) {
          global.__downloadedFiles = downloads;
        }
        downloads.push({
          href: target.href,
          download: target.download ?? '',
        });
      };
      global.__downloadListener = handler;
      global.document?.addEventListener?.('click', handler as never, true);
    });
  }

  public async getCapturedDownloads(): Promise<Array<{ href: string; download: string }>> {
    const captured = (await this.browser.execute(
      () => (globalThis as unknown as GlobalShim).__downloadedFiles ?? [],
    )) as unknown;
    return Array.isArray(captured) ? (captured as Array<{ href: string; download: string }>) : [];
  }

  public async removeLocalFile(fileName: string): Promise<void> {
    const button = await this.localRemoveButton(fileName);
    await button.waitForClickable({ timeout: 10000 });
    await button.click();
  }

  public async waitForLocalFileAbsent(fileName: string, timeout: number = 10000): Promise<void> {
    await this.localFileRow(fileName).waitForExist({ timeout, reverse: true });
  }

  public async waitForRemoteFileAbsent(fileName: string, timeout: number = 10000): Promise<void> {
    await this.remoteFileRow(fileName).waitForExist({ timeout, reverse: true });
  }
}

export const roomPageOwner: RoomPage = new RoomPage('owner');
export const roomPageGuest: RoomPage = new RoomPage('guest');
