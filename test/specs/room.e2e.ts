import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@wdio/globals';
import { homePageGuest, homePageOwner } from '../pageobjects/home.page';
import { roomPageGuest, roomPageOwner } from '../pageobjects/room.page';

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = dirname(__filename);
const fixturesDir: string = resolve(__dirname, '../fixtures');
const moonFixture: string = resolve(fixturesDir, 'moon-view.jpg');
const ziggFixture: string = resolve(fixturesDir, 'zigg.png');
const moonName: string = 'moon-view.jpg';
const ziggName: string = 'zigg.png';
const expectedMoonSize: number = statSync(moonFixture).size;

async function openHomePages(): Promise<void> {
  await Promise.all([homePageOwner.open(), homePageGuest.open()]);
}

async function ownerCreatesRoomAndCopiesSecret(): Promise<string> {
  await homePageOwner.createRoom();
  await roomPageOwner.waitForLoaded();
  await roomPageOwner.stubClipboard();
  await roomPageOwner.copySecret();
  await roomPageOwner.waitForCopyConfirmation();
  return roomPageOwner.getCopiedSecret();
}

async function guestJoinsRoom(secret: string): Promise<void> {
  await homePageGuest.openJoinRoomModal();
  await homePageGuest.fillJoinRoomModal(secret);
  await homePageGuest.joinRoom();
  await roomPageGuest.waitForLoaded();
}

async function waitForConnectionIndicators(): Promise<void> {
  await Promise.all([
    roomPageOwner.waitForMetaPanelConnected(),
    roomPageGuest.waitForMetaPanelConnected(),
  ]);

  const [ownerSas, guestSas] = await Promise.all([
    roomPageOwner.getSasValue(),
    roomPageGuest.getSasValue(),
  ]);
  expect(ownerSas).toBe(guestSas);

  const [ownerAuth, guestAuth] = await Promise.all([
    roomPageOwner.getAuthValue(),
    roomPageGuest.getAuthValue(),
  ]);
  expect(ownerAuth).not.toEqual('');
  expect(guestAuth).not.toEqual('');
}

async function shareMoonFile(): Promise<string> {
  await roomPageOwner.simulateDragEnter();
  await roomPageOwner.waitForDropOverlayVisible();
  await roomPageOwner.simulateDragLeave();
  await roomPageOwner.waitForDropOverlayHidden();

  await roomPageGuest.stubDownloadCapture();

  await roomPageOwner.uploadLocalFile(moonFixture);
  await roomPageOwner.waitForLocalFile(moonName);
  await roomPageGuest.waitForRemoteFile(moonName);

  await roomPageGuest.requestRemoteFile(moonName);
  await roomPageGuest.waitForRemoteFileReady(moonName);

  const moonHref = await roomPageGuest.getRemoteDownloadHref(moonName);
  expect(moonHref).toContain('blob:');

  const downloadedSize = await roomPageGuest.fetchRemoteFileSize(moonName);
  expect(downloadedSize).toBe(expectedMoonSize);

  await roomPageGuest.clickRemoteDownloadLink(moonName);
  const capturedDownloads = await roomPageGuest.getCapturedDownloads();
  expect(
    capturedDownloads.some((entry) => entry.download === moonName && entry.href === moonHref),
  ).toBe(true);

  return moonHref;
}

async function shareAndRemoveZiggFile(): Promise<void> {
  await roomPageOwner.uploadLocalFile(ziggFixture);
  await roomPageOwner.waitForLocalFile(ziggName);
  await roomPageGuest.waitForRemoteFile(ziggName);

  await roomPageOwner.removeLocalFile(ziggName);
  await roomPageOwner.waitForLocalFileAbsent(ziggName);
  await roomPageGuest.waitForRemoteFileAbsent(ziggName);
}

describe('p2p file exchange', () => {
  it('happy path', async () => {
    await openHomePages();

    const copiedSecret = await ownerCreatesRoomAndCopiesSecret();
    expect(copiedSecret).toBeTruthy();

    await guestJoinsRoom(copiedSecret);
    await waitForConnectionIndicators();

    const moonHref = await shareMoonFile();
    await shareAndRemoveZiggFile();

    const moonHrefAfterDeletion = await roomPageGuest.getRemoteDownloadHref(moonName);
    expect(moonHrefAfterDeletion).toBe(moonHref);
  });
});
