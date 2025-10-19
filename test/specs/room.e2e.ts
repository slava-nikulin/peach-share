import { homeOwnerPage } from '../pageobjects/home.page';

describe('p2p file exchange', () => {
  it('happy path', async () => {
    await homeOwnerPage.open();
    await homeOwnerPage.openJoinRoomModal();
    await homeOwnerPage.fillJoinRoomModal('test');
    await homeOwnerPage.joinRoom();

    await homeOwnerPage.pause(100000);
  });
});
