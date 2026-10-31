/**
 * Novamail - renderer entry point.
 *
 * In the desktop shell window.novamail already exists. When the renderer is
 * opened in a plain browser (design work, screenshots) a demo bridge is
 * installed instead, and the UI clearly labels itself as demo data.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppProvider } from './state/AppProvider'
import './styles/tokens.css'
import './styles/app.css'

async function bootstrap(): Promise<void> {
  if (!window.novamail) {
    const { installMockBridge } = await import('./mockBridge')
    installMockBridge()
  }

  const container = document.getElementById('root')
  if (!container) throw new Error('Novamail could not start: the root element is missing.')

  createRoot(container).render(
    <StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </StrictMode>
  )
}

void bootstrap().catch((error: unknown) => {
  console.error('[novamail] renderer failed to start', error)
  const container = document.getElementById('root')
  if (container) {
    container.textContent =
      'Novamail could not start. Please close the window and open the app again. If the problem continues, reinstall Novamail.'
  }
})
