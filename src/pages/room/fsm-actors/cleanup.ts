import { ref, remove } from 'firebase/database';
import type { RtdbConnector } from '../lib/RtdbConnector';

export async function cleanUp(rtdb: RtdbConnector, roomId: string): Promise<void> {
  const database = rtdb.connect();
  rtdb.ensureOnline();
  try {
    await remove(ref(database, `rooms/${roomId}`));
  } catch (error) {
    console.warn('Room cleanup error:', error);
  } finally {
    rtdb.cleanup();
  }
}
