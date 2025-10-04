import { useNavigate } from '@solidjs/router';
import type { ModalInterface, ModalOptions } from 'flowbite';
import Modal from 'flowbite/lib/esm/components/modal';
import type { JSX } from 'solid-js';

export interface RoomModalHandle {
  show: () => void;
  hide: () => void;
}

interface RoomModalProps {
  onReady?: (api: RoomModalHandle) => void;
  onClose?: () => void;
  onSubmitRoom?: (roomCode: string) => Promise<void> | void;
  title?: string;
  submitBtnClass?: string;
  submitBtnText?: string;
  modalId?: string;
  fillWithDefault?: boolean;
}

export function RoomModal(props: RoomModalProps): JSX.Element {
  let modal: ModalInterface | undefined;
  let inputEl: HTMLInputElement | undefined;

  const initModal = (element: HTMLDivElement): void => {
    if (!element) return;

    const options: ModalOptions = {
      placement: 'center',
      backdrop: 'dynamic',
      backdropClasses: 'bg-gray-900/50 dark:bg-gray-900/80 fixed inset-0 z-40',
      closable: true,
      onShow: () => {
        window.setTimeout(() => inputEl?.focus(), 100);
      },
      onHide: () => {
        props.onClose?.();
      },
    };

    modal = new Modal(element, options);

    props.onReady?.({
      show: () => modal?.show(),
      hide: () => modal?.hide(),
    });
  };

  const handleBackdropClick = (event: MouseEvent): void => {
    if (event.target === event.currentTarget) {
      modal?.hide();
    }
  };

  const handleInputRef = (element: HTMLInputElement): void => {
    if (!element) return;
    inputEl = element;
  };

  return (
    <div
      ref={initModal}
      id={props.modalId}
      tabindex="-1"
      aria-hidden="true"
      class="fixed top-0 right-0 left-0 z-50 hidden h-[calc(100%-1rem)] max-h-full w-full items-center justify-center overflow-y-auto overflow-x-hidden md:inset-0"
      onClick={handleBackdropClick}
    >
      <div class="relative max-h-full w-full max-w-sm p-4">
        <div class="relative rounded-lg border border-gray-600 bg-gray-50 shadow-lg">
          <div class="flex items-center justify-center rounded-t border-gray-200 border-b p-4 md:p-5">
            <h3 class="font-semibold text-gray-900 text-xl">{props.title || '_modal_title_'}</h3>
          </div>

          <div class="p-4 md:p-5">
            <RoomModalForm
              uniqueModalId={props.modalId}
              flowBiteModal={modal}
              inputRef={handleInputRef}
              onSubmitRoom={props.onSubmitRoom}
              submitBtnClass={props.submitBtnClass}
              submitBtnText={props.submitBtnText}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface RoomModalFormProps {
  uniqueModalId?: string;
  flowBiteModal?: ModalInterface;
  inputRef: (element: HTMLInputElement) => void;
  onSubmitRoom?: (roomCode: string) => Promise<void> | void;
  submitBtnClass?: string;
  submitBtnText?: string;
}

function RoomModalForm(props: RoomModalFormProps): JSX.Element {
  const navigate = useNavigate();
  const inputId = `${props.uniqueModalId}-input`;

  const handleFormSubmit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();

    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const roomCodeValue = formData.get('room-id');

    if (typeof roomCodeValue !== 'string') {
      alert('Room ID is required');
      return;
    }

    const roomCode = roomCodeValue.trim();

    try {
      await props.onSubmitRoom?.(roomCode);
      props.flowBiteModal?.hide();
      navigate(`/room/${roomCode}`);
    } catch (error) {
      console.error('Error joining room:', error);
      alert('Failed to join room. Please try again.');
    }
  };

  return (
    <form class="space-y-4" onSubmit={handleFormSubmit}>
      <div class="flex flex-col items-center space-y-3">
        <input
          ref={props.inputRef}
          id={inputId}
          name="room-id"
          type="text"
          class="w-19 rounded-lg border border-gray-300 user-invalid:border-red-500 bg-gray-50 px-3 py-2.5 text-gray-900 text-lg `focus:ring-4 transition-colors invalid:border-red-500 focus:border-blue-500 focus:outline-none focus:ring-blue-300"
          required
          autocomplete="off"
        />
        <p class="mt-2 text-gray-500 text-sm">Paste here room ID</p>
      </div>

      <div class="flex items-center justify-around gap-3 border-gray-200 border-t pt-4">
        <button
          type="submit"
          class={` ${props.submitBtnClass ?? ''} rounded-lg px-5 py-2.5 text-center font-medium text-md shadow-lg transition-all duration-200 hover:cursor-pointer hover:shadow-xl focus:outline-none focus:ring-4`}
        >
          {props.submitBtnText || '_submit_btn_text_'}
        </button>
        <button
          type="button"
          class="rounded-lg border border-gray-200 bg-white px-5 py-2.5 font-medium text-gray-900 text-md transition-colors hover:cursor-pointer hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:outline-none focus:ring-4 focus:ring-gray-100"
          onClick={() => props.flowBiteModal?.hide()}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
