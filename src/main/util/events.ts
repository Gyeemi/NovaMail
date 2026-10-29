/**
 * Novamail - in-process typed event bus (main -> services -> renderer bridge).
 */
import type { EventName, NovaMailEvents } from '@shared/ipc'
import { createLogger } from './logger'

const log = createLogger('events')

type Listener<E extends EventName> = (payload: NovaMailEvents[E]) => void

class TypedEmitter {
  private listeners = new Map<EventName, Set<(payload: never) => void>>()

  on<E extends EventName>(event: E, listener: Listener<E>): () => void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener as (payload: never) => void)
    this.listeners.set(event, set)
    return () => set.delete(listener as (payload: never) => void)
  }

  emit<E extends EventName>(event: E, payload: NovaMailEvents[E]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) {
      try {
        ;(listener as Listener<E>)(payload)
      } catch (error) {
        log.error('event listener failed', { event, error })
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}

export const appEvents = new TypedEmitter()
