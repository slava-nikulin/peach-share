import type { ChainablePromiseElement } from 'webdriverio';
import { Page } from './page';

class RoomPage extends Page {
  private get dropzone(): ChainablePromiseElement {
    return this.browser.$('[data-testid="room-dropzone"]');
  }

  public async waitForRoomUrl(): Promise<void> {
    await this.browser.waitUntil(async () => (await this.browser.getUrl()).includes('/room/'), {
      timeout: 7000,
      timeoutMsg: 'url did not navigate to /room/',
    });
  }

  public async waitForContent(): Promise<void> {
    await this.waitForRoomUrl();
    await this.dropzone.waitForDisplayed({ timeout: 7000 });
  }

  private get sessionStateLabel(): ChainablePromiseElement {
    return this.browser.$('//span[starts-with(normalize-space(), "Session:")]');
  }

  private get transfersCard(): ChainablePromiseElement {
    return this.browser.$(
      '//div[contains(@class,"rounded-2xl")][.//div[normalize-space()="Transfers"]]',
    );
  }

  private sectionRoot(section: 'You' | 'Guest'): ChainablePromiseElement {
    return this.browser.$(
      `//span[normalize-space()="${section}"]/ancestor::div[contains(@class,"rounded-2xl")][1]`,
    );
  }

  private sectionFileRow(section: 'You' | 'Guest', fileName: string): ChainablePromiseElement {
    const file = asXPathLiteral(fileName);
    return this.browser.$(
      `//span[normalize-space()="${section}"]/ancestor::div[contains(@class,"rounded-2xl")][1]//div[contains(@class,"rounded-lg")][.//div[contains(@class,"truncate") and normalize-space()=${file}]]`,
    );
  }

  public async waitForSessionReady(): Promise<void> {
    await this.waitForContent();
    await this.sessionStateLabel.waitForDisplayed({ timeout: 7000 });
    await this.browser.waitUntil(
      async () => {
        return (await this.sessionStateLabel.getText()).trim() === 'Session: Ready';
      },
      { timeout: 20_000, timeoutMsg: 'room session did not become ready' },
    );
  }

  public async uploadFiles(localPaths: readonly string[]): Promise<void> {
    if (localPaths.length === 0) return;

    await this.waitForSessionReady();
    const inputSelector = '[data-testid="room-dropzone"] input[type="file"]';
    const input = this.browser.$(inputSelector);
    await input.waitForExist({ timeout: 7000 });
    await input.waitForEnabled({ timeout: 7000 });

    const remotePaths: string[] = [];
    for (const path of localPaths) {
      remotePaths.push(await this.browser.uploadFile(path));
    }

    const wasShown = await this.browser.execute((selector: string) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return false;
      el.classList.remove('hidden');
      el.style.display = 'block';
      el.style.visibility = 'visible';
      el.style.pointerEvents = 'auto';
      el.style.opacity = '1';
      el.style.position = 'fixed';
      el.style.left = '0';
      el.style.top = '0';
      el.style.width = '1px';
      el.style.height = '1px';
      el.style.zIndex = '9999';
      return true;
    }, inputSelector);

    if (!wasShown) {
      throw new Error('file input not found in room dropzone');
    }

    try {
      const visibleInput = this.browser.$(inputSelector);
      await visibleInput.setValue(remotePaths.join('\n'));
    } finally {
      await this.browser.execute((selector: string) => {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) return;
        el.classList.add('hidden');
        el.style.display = '';
        el.style.visibility = '';
        el.style.pointerEvents = '';
        el.style.opacity = '';
        el.style.position = '';
        el.style.left = '';
        el.style.top = '';
        el.style.width = '';
        el.style.height = '';
        el.style.zIndex = '';
      }, inputSelector);
    }
  }

  public async waitForMyFile(fileName: string, timeout: number = 20_000): Promise<void> {
    await this.waitForFileInSection('You', fileName, timeout);
  }

  public async waitForGuestFile(fileName: string, timeout: number = 20_000): Promise<void> {
    await this.waitForFileInSection('Guest', fileName, timeout);
  }

  public async waitForMyFileAbsent(fileName: string, timeout: number = 20_000): Promise<void> {
    await this.waitForFileAbsentInSection('You', fileName, timeout);
  }

  public async waitForGuestFileAbsent(fileName: string, timeout: number = 20_000): Promise<void> {
    await this.waitForFileAbsentInSection('Guest', fileName, timeout);
  }

  public async unshareMyFile(fileName: string): Promise<void> {
    const row = this.sectionFileRow('You', fileName);
    await row.waitForExist({ timeout: 20_000 });
    const button = row.$('button=Unshare');
    await button.waitForClickable({ timeout: 20_000 });
    await button.click();
  }

  public async downloadGuestFile(fileName: string): Promise<void> {
    const row = this.sectionFileRow('Guest', fileName);
    await row.waitForExist({ timeout: 20_000 });
    const button = row.$('button=Download');
    await button.waitForClickable({ timeout: 20_000 });
    await button.click();
  }

  public async waitForTransferStatus(
    dir: 'send' | 'recv',
    fileName: string,
    status: 'preparing' | 'active' | 'done' | 'cancelled' | 'error',
    timeout: number = 30_000,
  ): Promise<void> {
    await this.transfersCard.waitForDisplayed({ timeout: 7000 });

    const expectedDir = dir.toLowerCase();
    const expectedFileName = fileName.toLowerCase();
    const statusMark = `- ${status}`.toLowerCase();
    await this.browser.waitUntil(
      async () => {
        const rows = await this.transfersCard.$$('div.border-t');
        if (rows.length === 0) return false;

        for (const row of rows) {
          if (!row) continue;
          let text = '';
          try {
            text = (await row.getText()).toLowerCase();
          } catch {
            continue;
          }
          if (
            text.includes(expectedDir) &&
            text.includes(expectedFileName) &&
            text.includes(statusMark)
          ) {
            return true;
          }
        }
        return false;
      },
      {
        timeout,
        timeoutMsg: `transfer ${dir}/${fileName} did not reach status "${status}"`,
      },
    );
  }

  private async waitForFileInSection(
    section: 'You' | 'Guest',
    fileName: string,
    timeout: number,
  ): Promise<void> {
    await this.sectionRoot(section).waitForDisplayed({ timeout: 7000 });
    await this.browser.waitUntil(
      async () => {
        return this.sectionFileRow(section, fileName).isExisting();
      },
      { timeout, timeoutMsg: `${section} section does not contain "${fileName}"` },
    );
  }

  private async waitForFileAbsentInSection(
    section: 'You' | 'Guest',
    fileName: string,
    timeout: number,
  ): Promise<void> {
    await this.sectionRoot(section).waitForDisplayed({ timeout: 7000 });
    await this.browser.waitUntil(
      async () => {
        return !(await this.sectionFileRow(section, fileName).isExisting());
      },
      { timeout, timeoutMsg: `${section} section still contains "${fileName}"` },
    );
  }

  private get errorRoot(): ChainablePromiseElement {
    return this.browser.$('[data-testid="room-error"]');
  }

  private get errorTitle(): ChainablePromiseElement {
    return this.browser.$('[data-testid="room-error-title"]');
  }

  private get errorMessage(): ChainablePromiseElement {
    return this.browser.$('[data-testid="room-error-message"]');
  }

  public async waitForError(): Promise<void> {
    await this.waitForRoomUrl();
    await this.errorRoot.waitForDisplayed({ timeout: 7000 });
  }

  public async getErrorTitleText(): Promise<string> {
    await this.waitForError();
    return this.errorTitle.getText();
  }

  public async getErrorMessageText(): Promise<string> {
    await this.waitForError();
    return this.errorMessage.getText();
  }
}

export const roomPageOwner: RoomPage = new RoomPage('owner');
export const roomPageGuest: RoomPage = new RoomPage('guest');

function asXPathLiteral(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }

  const parts = value.split("'").map((part) => `'${part}'`);
  return `concat(${parts.join(`, "'", `)})`;
}
