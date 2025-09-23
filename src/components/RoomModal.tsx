import { onMount, onCleanup, createEffect, createSignal } from 'solid-js'
import { Modal } from 'flowbite'
import type { ModalOptions, ModalInterface } from 'flowbite'
import ModalManager from '../utils/modalManager'

interface RoomModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmitRoom: (event: Event) => void
  defaultCode: string
  modalId?: string
  title?: string // Добавим возможность кастомизировать заголовок
}

export default function RoomModal(props: RoomModalProps) {
  let modalElement: HTMLDivElement | undefined
  let modal: ModalInterface | undefined

  // Генерируем уникальный ID для каждого компонента
  const [uniqueModalId] = createSignal(
    props.modalId ||
      `create-room-modal-${Math.random().toString(36).substr(2, 9)}`
  )

  // Уникальный input ID тоже нужен
  const [inputId] = createSignal(
    `room-code-${uniqueModalId().split('-').pop()}`
  )

  onMount(() => {
    if (!modalElement) return

    // Проверяем через Modal Manager, не существует ли уже экземпляр
    if (ModalManager.isModalOpen(uniqueModalId())) {
      console.warn(`Modal instance with ID ${uniqueModalId()} already exists`)
      return
    }

    const modalOptions: ModalOptions = {
      placement: 'center',
      backdrop: 'dynamic',
      backdropClasses: 'bg-gray-900/50 dark:bg-gray-900/80 fixed inset-0 z-40',
      closable: true,
      onHide: () => {
        console.log(`Modal ${uniqueModalId()} is hidden`)
        // Уведомляем Modal Manager о закрытии
        ModalManager.unregisterModal(uniqueModalId())
        props.onClose()
      },
      onShow: () => {
        console.log(`Modal ${uniqueModalId()} is shown`)
        // Автофокус на input при открытии
        const input = modalElement?.querySelector(
          `#${inputId()}`
        ) as HTMLInputElement
        if (input) {
          setTimeout(() => input.focus(), 150)
        }
      },
      onToggle: () => {
        console.log(`Modal ${uniqueModalId()} has been toggled`)
      },
    }

    try {
      // Создаем экземпляр модального окна
      modal = new Modal(modalElement, modalOptions)

      // Регистрируем в Modal Manager
      ModalManager.registerModal(uniqueModalId(), modal)
    } catch (error) {
      console.error(`Failed to create modal ${uniqueModalId()}:`, error)
    }
  })

  // Реактивно управляем видимостью модального окна
  createEffect(() => {
    if (!modal) return

    try {
      if (props.isOpen) {
        // Закрываем все другие модальные окна перед открытием нового
        ModalManager.hideAllModals()
        modal.show()
      } else {
        modal.hide()
      }
    } catch (error) {
      console.error(`Error controlling modal ${uniqueModalId()}:`, error)
    }
  })

  onCleanup(() => {
    // Modal Manager сам очистит при unregister
    ModalManager.unregisterModal(uniqueModalId())
  })

  const handleClose = () => {
    if (modal) {
      modal.hide() // Modal Manager автоматически unregister через onHide callback
    }
  }

  const handleFormSubmit = (event: Event) => {
    event.preventDefault()
    props.onSubmitRoom(event)
  }

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }

  return (
    <div
      ref={modalElement}
      id={uniqueModalId()}
      tabindex="-1"
      aria-hidden="true"
      class="hidden overflow-y-auto overflow-x-hidden fixed top-0 right-0 left-0 z-50 justify-center items-center w-full md:inset-0 h-[calc(100%-1rem)] max-h-full"
      onClick={handleBackdropClick}
    >
      <div class="relative p-4 w-full max-w-sm max-h-full">
        {/* Modal content */}
        <div class="relative bg-gray-50 rounded-lg shadow-lg border border-gray-600 ">
          {/* Modal header */}
          <div class="flex items-center justify-center p-4 md:p-5 border-b rounded-t border-gray-200">
            <h3 class="text-xl font-semibold text-gray-900 ">
              {props.title || '_modal_title_'}
            </h3>
          </div>

          {/* Modal body */}
          <div class="p-4 md:p-5">
            <form class="space-y-4" onSubmit={handleFormSubmit}>
              <div class="flex flex-col items-center space-y-3">
                <input
                  id={inputId()}
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
                  value={props.defaultCode}
                  required
                  autocomplete="off"
                />
                <p class="mt-2 text-sm text-gray-500 -400">
                  Enter a 4-digit room code
                </p>
              </div>

              {/* Modal footer */}
              <div class="flex items-center justify-between gap-3 pt-4 border-t border-gray-200 ">
                <button
                  type="submit"
                  class="text-white bg-gradient-to-r from-purple-500 via-purple-600 to-purple-700 hover:from-purple-600 hover:via-purple-700 hover:to-purple-800 focus:ring-4 focus:outline-none focus:ring-purple-300 font-medium rounded-lg 
                  text-md px-5 py-2.5 text-center transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  Create Room
                </button>
                <button
                  type="button"
                  class="py-2.5 px-5 text-md font-medium text-gray-900 focus:outline-none bg-white rounded-lg border border-gray-200 hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:ring-gray-100 transition-colors"
                  onClick={handleClose}
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
