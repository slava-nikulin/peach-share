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

  private get confirmModalTitle(): ChainablePromiseElement {
    // Заголовок модалки: "Create room?" или "Join room?"
    return this.browser.$('h3');
  }

  public async generateRoomCode(): Promise<void> {
    await this.roomCodeInput.waitForExist();
    await this.generatePrsButton.click();
  }

  public async start(): Promise<void> {
    await this.startButton.waitForEnabled();
    await this.startButton.click();
  }

  public async waitForConfirmModal(): Promise<void> {
    await this.confirmModalTitle.waitForDisplayed({ timeout: 7000 });
  }

  public async getConfirmModalTitleText(): Promise<string> {
    await this.waitForConfirmModal();
    return this.confirmModalTitle.getText();
  }
}

export const homePageOwner: HomePage = new HomePage('owner');
export const homePageGuest: HomePage = new HomePage('guest');
