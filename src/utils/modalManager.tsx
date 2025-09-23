// src/utils/modalManager.ts
class ModalManager {
  private static instance: ModalManager
  private modals: Map<string, any> = new Map()

  static getInstance(): ModalManager {
    if (!ModalManager.instance) {
      ModalManager.instance = new ModalManager()
    }
    return ModalManager.instance
  }

  registerModal(id: string, modal: any) {
    if (this.modals.has(id)) {
      console.warn(`Modal with ID ${id} is already registered`)
      return
    }
    this.modals.set(id, modal)
  }

  unregisterModal(id: string) {
    if (this.modals.has(id)) {
      const modal = this.modals.get(id)
      try {
        modal?.hide()
      } catch (e) {
        console.warn(`Error hiding modal ${id}:`, e)
      }
      this.modals.delete(id)
    }
  }

  hideAllModals() {
    this.modals.forEach((modal, id) => {
      try {
        modal.hide()
      } catch (e) {
        console.warn(`Error hiding modal ${id}:`, e)
      }
    })
  }

  isModalOpen(id: string): boolean {
    return this.modals.has(id)
  }
}

export default ModalManager.getInstance()
