import path from 'node:path';

const fixturesRoot: string = path.resolve(process.cwd(), 'src/tests/wdio/fixtures/files');

export const roomFileFixtures = {
  ownerContract: {
    name: 'owner-contract.txt',
    path: path.join(fixturesRoot, 'owner-contract.txt'),
  },
  ownerMetadata: {
    name: 'owner-metadata.json',
    path: path.join(fixturesRoot, 'owner-metadata.json'),
  },
  guestReply: {
    name: 'guest-reply.txt',
    path: path.join(fixturesRoot, 'guest-reply.txt'),
  },
} as const;
