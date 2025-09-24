// RoomModal.tsx
import { onMount, onCleanup } from 'solid-js'
import { Modal } from 'flowbite'
import type { ModalOptions, ModalInterface } from 'flowbite'

export type RoomModalHandle = {
  show: () => void
  hide: () => void
}

interface RoomModalProps {
  onReady?: (api: RoomModalHandle) => void // наружный контроллер
  onClose?: () => void // колбэк закрытия
  onSubmitRoom: (event: Event) => void // отправка формы
  title?: string // заголовок окна
  submitBtnClass?: string
  submitBtnText?: string
  modalId?: string // кастомный ID
  fillWithDefault?: boolean // автозаполнение при открытии
}

export default function RoomModal(props: RoomModalProps) {
  let modalElement: HTMLDivElement | undefined
  let inputEl: HTMLInputElement | undefined
  let modal: ModalInterface | undefined

  const uniqueModalId =
    props.modalId || `room-modal-${Math.random().toString(36).slice(2, 9)}`
  const inputId = `room-code-${uniqueModalId.split('-').pop()}`

  const random4 = () =>
    Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0')

  const fillWithDefault = () => {
    const code = random4()
    if (inputEl) inputEl.value = code
  }

  onMount(() => {
    if (!modalElement) return

    const modalOptions: ModalOptions = {
      placement: 'center',
      backdrop: 'dynamic',
      backdropClasses: 'bg-gray-900/50 dark:bg-gray-900/80 fixed inset-0 z-40',
      closable: true,
      onShow: () => {
        if (props.fillWithDefault) fillWithDefault()
        setTimeout(() => inputEl?.focus(), 100)
      },
      onHide: () => {
        props.onClose?.()
      },
    }

    modal = new Modal(modalElement, modalOptions)

    const api: RoomModalHandle = {
      show: () => modal?.show(),
      hide: () => modal?.hide(),
    }

    props.onReady?.(api)
  })

  onCleanup(() => {
    try {
      modal?.hide()
    } catch {}
  })

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) modal?.hide()
  }

  const handleFormSubmit = (event: Event) => {
    event.preventDefault()
    props.onSubmitRoom(event)
  }

  return (
    <div
      ref={modalElement}
      id={uniqueModalId}
      tabindex="-1"
      aria-hidden="true"
      class="hidden overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 justify-center items-center w-full md:inset-0 h-[calc(100%-1rem)] max-h-full"
      onClick={handleBackdropClick}
    >
      <div class="relative p-4 w-full max-w-sm max-h-full">
        <div class="relative bg-gray-50 rounded-lg shadow-lg border border-gray-600">
          <div class="flex items-center justify-center p-4 md:p-5 border-b rounded-t border-gray-200">
            <h3 class="text-xl font-semibold text-gray-900">
              {props.title || '_modal_title_'}
            </h3>
          </div>

          <div class="p-4 md:p-5">
            <form class="space-y-4" onSubmit={handleFormSubmit}>
              <div class="flex flex-col items-center space-y-3">
                <input
                  ref={(el) => (inputEl = el)}
                  id={inputId}
                  name="room-code"
                  type="text"
                  inputmode="numeric"
                  pattern="\d{4}"
                  maxlength="4"
                  class="w-19 bg-gray-50 border border-gray-300 text-gray-900 text-lg rounded-lg
                   focus:ring-4 focus:ring-blue-300 focus:border-blue-500 focus:outline-none
                   invalid:border-red-500 user-invalid:border-red-500
                   transition-colors px-3 py-2.5"
                  placeholder="0000"
                  required
                  autocomplete="off"
                />
                <p class="mt-2 text-sm text-gray-500">
                  Enter a 4-digit room code
                </p>
              </div>

              <div class="flex items-center justify-around gap-3 pt-4 border-t border-gray-200">
                <button
                  type="submit"
                  class={` ${props.submitBtnClass ?? ''}
                   focus:ring-4 focus:outline-none font-medium rounded-lg text-md px-5 py-2.5 text-center
                  transition-all duration-200 shadow-lg hover:shadow-xl hover:cursor-pointer`}
                >
                  {props.submitBtnText || '_submit_btn_text_'}
                </button>
                <button
                  type="button"
                  class="py-2.5 px-5 text-md font-medium text-gray-900 focus:outline-none bg-white rounded-lg border border-gray-200 hover:bg-gray-100 hover:text-blue-700
                   focus:z-10 focus:ring-4 focus:ring-gray-100 transition-colors hover:cursor-pointer"
                  onClick={() => modal?.hide()}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
