import type { useNavigate } from '@solidjs/router';
import type { RoomModalHandle } from '../../components/RoomModal';
import { fromBase64Url, hkdfPathId } from '../../lib/crypto';

interface JoinHandlers {
  handleJoinRoomForm: (secretB64: string) => Promise<void>;
  handleJoinButtonClick: () => void;
  handleModalReady: (api: RoomModalHandle) => void;
}

export const createJoinHandlers = (navigate: ReturnType<typeof useNavigate>): JoinHandlers => {
  let joinRoomModal: RoomModalHandle | undefined;

  const handleJoinRoomForm = async (secretB64: string): Promise<void> => {
    const secret = fromBase64Url(secretB64);
    const pathId = await hkdfPathId(secret, 'path', 128);

    navigate(`/room/${pathId}`, {
      state: { secret: secretB64, intent: 'join' },
    });
  };

  const handleJoinButtonClick = (): void => {
    joinRoomModal?.show();
  };

  const handleModalReady = (api: RoomModalHandle): void => {
    joinRoomModal = api;
  };

  return { handleJoinRoomForm, handleJoinButtonClick, handleModalReady };
};
