import type { ChainablePromiseElement } from 'webdriverio';
import { Page } from './page';

class HomePage extends Page {
  private get roomCodeInput(): ChainablePromiseElement {
    return this.browser.$('input[name="room-id"]');
  }

  private get generatePrsButton(): ChainablePromiseElement {
    return this.browser.$('button[title="Generate random code"]');
  }

  private get startButton(): ChainablePromiseElement {
    return this.browser.$('button[type="submit"]');
  }

  private get confirmDialog(): ChainablePromiseElement {
    return this.browser.$('div.relative.z-10');
  }

  private get confirmModalTitle(): ChainablePromiseElement {
    // Заголовок модалки: "Create room?" или "Join room?"
    return this.browser.$('h3');
  }

  private get confirmModalBody(): ChainablePromiseElement {
    return this.confirmDialog.$('p');
  }

  private get confirmButton(): ChainablePromiseElement {
    return this.confirmDialog.$('button=Confirm');
  }

  public async waitForReady(): Promise<void> {
    await this.roomCodeInput.waitForDisplayed({ timeout: 7000 });
  }

  public async generateRoomCode(): Promise<void> {
    await this.waitForReady();
    await this.generatePrsButton.click();

    await this.browser.waitUntil(
      async () => /^\d{3}-\d{3}$/.test(await this.roomCodeInput.getValue()),
      { timeout: 2000, timeoutMsg: 'room code was not generated' },
    );
  }

  public async waitForConfirmModal(title: string, bodyIncludes: string): Promise<void> {
    const timeout = 7000;

    await this.confirmModalTitle.waitForDisplayed({ timeout });

    await this.browser.waitUntil(
      async () => (await this.confirmModalTitle.getText()).trim() === title,
      { timeout, timeoutMsg: `confirm modal title did not match: ${title}` },
    );

    if (bodyIncludes) {
      await this.browser.waitUntil(
        async () => (await this.confirmModalBody.getText()).includes(bodyIncludes),
        { timeout, timeoutMsg: `confirm modal body did not include: ${bodyIncludes}` },
      );
    }
  }

  public async clickConfirm(): Promise<void> {
    await this.confirmButton.waitForClickable({ timeout: 7000 });
    await this.confirmButton.click();
  }

  public async getRoomCodeFormatted(): Promise<string> {
    await this.waitForReady();
    return this.roomCodeInput.getValue();
  }

  public async start(): Promise<void> {
    await this.startButton.waitForEnabled();
    await this.startButton.click();
  }
}

export const homePageOwner: HomePage = new HomePage('owner');
export const homePageGuest: HomePage = new HomePage('guest');
