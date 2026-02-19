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
