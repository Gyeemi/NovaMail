/**
 * Novamail - renderer bridge access.
 *
 * The renderer has no Node.js access. Everything goes through window.novamail,
 * which the preload script exposes. The bridge is resolved lazily on every call
 * because the desktop preload and the browser demo bridge are installed at
 * different times; caching the object at module load would silently break one
 * of them.
 */
import type { EventName, NovaMailApi, NovaMailBridge, NovaMailEvents } from '@shared/ipc'

export class BridgeUnavailableError extends Error {
  constructor() {
    super('Novamail is running outside the desktop shell, so this action is unavailable.')
    this.name = 'BridgeUnavailableError'
  }
}

function bridge(): NovaMailBridge | undefined {
  return typeof window !== 'undefined' ? window.novamail : undefined
}

/** True when the Electron preload bridge is present (false in a browser preview). */
export function isDesktop(): boolean {
  return Boolean(bridge()) && !bridge()?.demo
}

/** True when the browser demo bridge is in use (sample data, no real mailbox). */
export function isDemo(): boolean {
  return Boolean(bridge()?.demo)
}

/**
 * A proxy that forwards each `api.group.method(...)` call to the live bridge.
 * Calls made before/without a bridge reject with a clear message instead of
 * crashing the renderer during first paint.
 */
export const api: NovaMailApi = new Proxy({} as NovaMailApi, {
  get: (_target, group: string | symbol) =>
    new Proxy(
      {},
      {
        get: (_inner, method: string | symbol) =>
          async (...args: unknown[]): Promise<unknown> => {
            const live = bridge()
            if (!live) throw new BridgeUnavailableError()
            const groupApi = (live.api as unknown as Record<string, Record<string, (...input: unknown[]) => Promise<unknown>>>)[
              String(group)
            ]
            const fn = groupApi?.[String(method)]
            if (typeof fn !== 'function') {
              throw new BridgeUnavailableError()
            }
            return fn.apply(groupApi, args)
          }
      }
    )
}) as NovaMailApi

export const system = {
  get platform(): string {
    return bridge()?.system.platform ?? 'browser'
  },
  get versions(): { electron: string; chrome: string; node: string; app: string } {
    return bridge()?.system.versions ?? { electron: '-', chrome: '-', node: '-', app: '1.0.0' }
  },
  on<E extends EventName>(event: E, listener: (payload: NovaMailEvents[E]) => void): () => void {
    const live = bridge()
    if (!live) return () => undefined
    return live.system.on(event, listener)
  },
  /** Resolves the absolute path of a file dropped onto the window. */
  getPathForFile(file: File): string {
    const live = bridge()
    if (!live) return ''
    try {
      return live.system.getPathForFile(file)
    } catch {
      return ''
    }
  }
}

export function on<E extends EventName>(event: E, listener: (payload: NovaMailEvents[E]) => void): () => void {
  return system.on(event, listener)
}

/** Human friendly message for anything thrown over the bridge. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message || ''
    // Electron prefixes IPC rejections with "Error invoking remote method ...".
    const cleaned = message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
    return cleaned || 'Something went wrong. Please try again.'
  }
  return String(error)
}
