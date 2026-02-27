/** biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: <explanation> */
import { expect } from '@wdio/globals';
import { roomFileFixtures } from '../fixtures/file-fixtures';
import { homePageGuest, homePageOwner } from '../pageobjects/home.page';
import { roomPageGuest, roomPageOwner } from '../pageobjects/room.page';

describe('p2p file exchange', () => {
  const createAndJoinRoom = async (): Promise<void> => {
    await homePageOwner.open();

    await homePageOwner.generateRoomCode();
    const code = await homePageOwner.getRoomCodeFormatted();

    await homePageOwner.start();

    await homePageOwner.waitForConfirmModal('Create room?', `Room ${code} was not found.`);

    await homePageOwner.clickConfirm();

    await homePageGuest.open();
    await homePageGuest.setRoomCodeFormatted(code);
    await homePageGuest.start();
    await homePageGuest.waitForConfirmModal('Join room?', `Room ${code} exists.`);
    await homePageGuest.clickConfirm();

    await roomPageGuest.waitForContent();
    await roomPageOwner.waitForContent();
  };

  it('happy path: owner creates and guest joins -> both see room content', async () => {
    await createAndJoinRoom();

    await roomPageOwner.waitForSessionReady();
    await roomPageGuest.waitForSessionReady();

    // Owner shares files.
    await roomPageOwner.uploadFiles([
      roomFileFixtures.ownerContract.path,
      roomFileFixtures.ownerMetadata.path,
    ]);
    await roomPageOwner.waitForMyFile(roomFileFixtures.ownerContract.name);
    await roomPageOwner.waitForMyFile(roomFileFixtures.ownerMetadata.name);
    await roomPageGuest.waitForGuestFile(roomFileFixtures.ownerContract.name);
    await roomPageGuest.waitForGuestFile(roomFileFixtures.ownerMetadata.name);

    // Guest downloads one of owner's files.
    await roomPageGuest.downloadGuestFile(roomFileFixtures.ownerContract.name);
    await roomPageGuest.waitForTransferStatus('recv', roomFileFixtures.ownerContract.name, 'done');
    await roomPageOwner.waitForTransferStatus('send', roomFileFixtures.ownerContract.name, 'done');

    // Owner unshares one file; peer inventory should update.
    await roomPageOwner.unshareMyFile(roomFileFixtures.ownerMetadata.name);
    await roomPageOwner.waitForMyFileAbsent(roomFileFixtures.ownerMetadata.name);
    await roomPageGuest.waitForGuestFileAbsent(roomFileFixtures.ownerMetadata.name);

    // Guest shares a file back and owner downloads it.
    await roomPageGuest.uploadFiles([roomFileFixtures.guestReply.path]);
    await roomPageGuest.waitForMyFile(roomFileFixtures.guestReply.name);
    await roomPageOwner.waitForGuestFile(roomFileFixtures.guestReply.name);

    await roomPageOwner.downloadGuestFile(roomFileFixtures.guestReply.name);
    await roomPageOwner.waitForTransferStatus('recv', roomFileFixtures.guestReply.name, 'done');
    await roomPageGuest.waitForTransferStatus('send', roomFileFixtures.guestReply.name, 'done');
  });

  it('happy path -> enter room -> back/forward should show error', async () => {
    await createAndJoinRoom();

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
