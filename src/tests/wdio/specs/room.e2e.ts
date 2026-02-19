import { expect } from '@wdio/globals';
import { homePageOwner } from '../pageobjects/home.page';
import { roomPageOwner } from '../pageobjects/room.page';

describe('p2p file exchange', () => {
  it('happy path -> enter room -> back/forward should show error', async () => {
    await homePageOwner.open();

    await homePageOwner.generateRoomCode();
    const code = await homePageOwner.getRoomCodeFormatted();

    await homePageOwner.start();

    await homePageOwner.waitForConfirmModal('Create room?', `Room ${code} was not found.`);

    await homePageOwner.clickConfirm();

    await roomPageOwner.waitForContent();

    // вперед обратно на room -> должна быть ошибка
    await roomPageOwner.back();
    await roomPageOwner.forward();
    await roomPageOwner.waitForError();

    await expect(await roomPageOwner.getErrorTitleText()).toBe('Room session expired');
    await expect(await roomPageOwner.getErrorMessageText()).toContain(
      "can't be reopened via browser history",
    );

    // await roomPageOwner.pause(10000);
  });

  it('direct hit: opening /room/:id directly should show error', async () => {
    // прямой переход по URL без state
    await roomPageOwner.open(`/room/1337`);

    await roomPageOwner.waitForError();
    await expect(await roomPageOwner.getErrorTitleText()).toBe('Invalid room link');
  });
});
