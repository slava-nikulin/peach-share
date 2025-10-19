import type { ChainablePromiseElement } from 'webdriverio';
import { Page } from './page';

class HomePage extends Page {
  private get joinRoomButton(): ChainablePromiseElement {
    return this.browser.$("//button[normalize-space(.)='Join room']");
  }

  private get createRoomButton(): ChainablePromiseElement {
    return this.browser.$("//button[normalize-space(.)='Start sharing']");
  }

  private get joinRoomModal(): ChainablePromiseElement {
    return this.browser.$("//*[@id='join-room-modal']");
  }

  private get joinRoomModalInput(): ChainablePromiseElement {
    return this.browser.$("//*[@id='join-room-modal']//input[@id='join-room-modal-input']");
  }

  private get joinRoomModalJoinButton(): ChainablePromiseElement {
    return this.browser.$("//*[@id='join-room-modal']//button[@type='submit']");
  }

  public async openJoinRoomModal(): Promise<void> {
    await this.joinRoomButton.waitForExist();
    await this.joinRoomButton.click();
  }

  public async fillJoinRoomModal(secret: string): Promise<void> {
    await this.joinRoomModal.waitForDisplayed();
    await this.joinRoomModalInput.waitForExist();
    await this.joinRoomModalInput.setValue(secret);
  }

  public async joinRoom(): Promise<void> {
    await this.joinRoomModalJoinButton.waitForExist();
    await this.joinRoomModalJoinButton.click();
  }

  public async createRoom(): Promise<void> {
    await this.createRoomButton.waitForExist();
    await this.createRoomButton.click();
  }
}

export const homeOwnerPage: HomePage = new HomePage('owner');
export const homeGuestPage: HomePage = new HomePage('guest');
