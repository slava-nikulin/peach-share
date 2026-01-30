import { expect } from '@wdio/globals';
import { homePageOwner } from '../pageobjects/home.page';

describe('p2p file exchange', () => {
  it('happy path: generate code -> start -> modal appears', async () => {
    await homePageOwner.open();

    await homePageOwner.generateRoomCode();
    await homePageOwner.start();

    await homePageOwner.waitForConfirmModal();

    // await homePageOwner.pause(10000);

    await expect(await homePageOwner.getConfirmModalTitleText()).toBe('Create room?');
  });
});
