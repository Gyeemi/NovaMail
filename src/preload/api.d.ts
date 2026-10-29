import type { NovaMailBridge } from '../shared/ipc'

declare global {
  interface Window {
    novamail?: NovaMailBridge
  }
}

export {}
