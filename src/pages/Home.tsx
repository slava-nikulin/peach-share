import { createSignal, onMount } from 'solid-js'
import RoomModal from '../components/RoomModal'

export default function Home() {
  const [isModalOpen, setIsModalOpen] = createSignal(false)
  const [defaultCode, setDefaultCode] = createSignal('0000')

  // Генерация случайного кода комнаты
  const generateRandomCode = () => {
    const code = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0')
    setDefaultCode(code)
  }

  onMount(() => {
    // Генерируем код при загрузке
    generateRandomCode()
  })

  const handleOpenModal = () => {
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleSubmitCreateRoom = (event: Event) => {
    const formData = new FormData(event.target as HTMLFormElement)
    const roomCode = formData.get('room-code') as string

    // Валидация кода комнаты
    if (!/^\d{4}$/.test(roomCode)) {
      alert('Please enter a valid 4-digit room code')
      return
    }

    console.log('Creating room with code:', roomCode)

    // Здесь ваша логика создания комнаты
    try {
      // Имитация API вызова
      setTimeout(() => {
        alert(`Room ${roomCode} created successfully!`)
        setIsModalOpen(false)
        // Генерируем новый код для следующего раза
        generateRandomCode()
      }, 500)
    } catch (error) {
      console.error('Error creating room:', error)
      alert('Failed to create room. Please try again.')
    }
  }

  return (
    <div class="grid grid-cols-1">
      <section class="mx-auto">
        {/* Instructions */}
        <div class="rounded-2xl border border-white/70 bg-white/60 p-5 shadow-sm mb-8">
          <h2 class="text-xl font-semibold mb-2">Instructions</h2>
          <ol class=" text-md max-w-md space-y-1 text-gray-500 list-decimal list-inside dark:text-slate-700">
            <li>Connect devices to the same Wi-Fi network.</li>
            <li>Create a room on one device.</li>
            <li>Connect from another device using the code/QR code.</li>
            <li>File sharing — in the next step.</li>
          </ol>
        </div>

        {/* Actions */}
        <div class="grid grid-rows-2 gap-y-5 justify-stretch items-center md:flex md:flex-row md:justify-around ">
          {/* Create */}
          <button
            type="button"
            onClick={handleOpenModal}
            class="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-pink-400 via-pink-500 to-pink-600 text-white px-5 py-2.5 text-lg
               shadow-sm hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-slate-900/20 hover:cursor-pointer"
          >
            Create room
          </button>

          {/* Join */}
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-xl border border-slate-900/10 bg-white px-5 py-2.5 text-lg
               hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-900/10 hover:cursor-pointer"
          >
            Join room
          </button>
        </div>
      </section>
      <RoomModal
        isOpen={isModalOpen()}
        onClose={handleCloseModal}
        onSubmitRoom={handleSubmitCreateRoom}
        defaultCode={defaultCode()}
      />
    </div>
  )
}
