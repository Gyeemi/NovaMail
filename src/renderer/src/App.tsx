/**
 * Novamail - application shell.
 *
 * Owns the three-pane layout, the global keyboard map and the overlay hosts
 * (composer, attachment preview, command palette, toasts, setup wizard).
 */
import { useEffect, type ReactNode } from 'react'
import { isDemo } from './bridge'
import { useApp } from './state/AppProvider'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { MailList } from './components/MailList'
import { ReadingPane } from './components/ReadingPane'
import { Compose } from './components/Compose'
import { AttachmentPreview } from './components/AttachmentPreview'
import { CommandPalette, ToastStack } from './components/Overlays'
import { Spinner } from './components/ui'
import { SettingsView } from './views/SettingsView'
import { SetupWizard } from './views/SetupWizard'
import { AboutView } from './views/AboutView'
import { CalendarView, ContactsView, TasksView } from './views/ProductivityViews'
import { RulesView, SignaturesView } from './views/AutomationViews'

export function App(): ReactNode {
  const { state, actions } = useApp()

  useTheme(state.settings)
  useKeyboard()

  if (!state.ready) {
    return (
      <div className="app-shell app-shell--loading">
        <Spinner large label="Starting Novamail" />
      </div>
    )
  }

  const readingPane = state.settings?.ui.readingPane ?? 'right'
  const showList = state.view === 'mail'

  return (
    <div className="app-shell">
      {isDemo() ? (
        <div className="demo-banner" role="status">
          <strong>Browser preview</strong> — this window shows sample data only. Install Novamail to connect a real
          mailbox; nothing here is sent anywhere.
        </div>
      ) : null}
      <TopBar />
      <div className="app-body">
        {state.settings && !state.settings.ui.sidebarCollapsed ? <Sidebar /> : null}

        <main className="workspace" aria-label="Mail workspace">
          {showList ? (
            readingPane === 'bottom' ? (
              <div className="mail-stack">
                <MailList />
                <ReadingPane />
              </div>
            ) : (
              <>
                <MailList />
                {readingPane === 'right' ? <ReadingPane /> : null}
              </>
            )
          ) : null}

          {state.view === 'settings' ? <SettingsView /> : null}
          {state.view === 'about' ? <AboutView /> : null}
          {state.view === 'contacts' ? <ContactsView /> : null}
          {state.view === 'calendar' ? <CalendarView /> : null}
          {state.view === 'tasks' ? <TasksView /> : null}
          {state.view === 'rules' ? <RulesView /> : null}
          {state.view === 'signatures' ? <SignaturesView /> : null}
        </main>
      </div>

      <footer className="app-footer">
        Novamail — produced by Baraily Inovex.
      </footer>

      <Compose />
      <AttachmentPreview />
      <CommandPalette />
      <ToastStack />
      {state.wizardOpen ? <SetupWizard /> : null}
    </div>
  )
}

/** Applies the appearance settings to the document root. */
function useTheme(settings: ReturnType<typeof useApp>['state']['settings']): void {
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.style.setProperty('--nm-accent', settings.ui.accent)
    root.style.setProperty('--nm-text-scale', String(settings.ui.textScale))
    root.dataset.depth = settings.ui.neumorphicIntensity
    root.dataset.density = settings.ui.density
    root.dataset.motion = settings.ui.reduceMotion ? 'reduced' : 'full'
  }, [settings])
}

/** Global shortcuts that do not belong to a single component. */
function useKeyboard(): void {
  const { state, actions } = useApp()

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true
      const modifier = event.ctrlKey || event.metaKey

      if (modifier && event.key.toLowerCase() === 'k' && event.shiftKey) {
        event.preventDefault()
        actions.setPaletteOpen(true, 'command')
        return
      }
      if (modifier && event.key === 'n') {
        event.preventDefault()
        void actions.openCompose('new')
        return
      }
      if (modifier && event.key === ',') {
        event.preventDefault()
        actions.setView('settings', 'appearance')
        return
      }
      if (event.key === 'F5') {
        event.preventDefault()
        void actions.syncNow()
        return
      }
      if (typing || modifier) return
      if (state.compose || state.paletteOpen) return

      const index = state.activeId ? state.messages.findIndex((message) => message.id === state.activeId) : -1

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          if (state.view !== 'mail' || state.messages.length === 0) return
          event.preventDefault()
          void actions.selectMessage(state.messages[Math.min(index + 1, state.messages.length - 1)]?.id ?? null)
          break
        case 'k':
        case 'ArrowUp':
          if (state.view !== 'mail' || state.messages.length === 0) return
          event.preventDefault()
          void actions.selectMessage(state.messages[Math.max(index - 1, 0)]?.id ?? null)
          break
        case 'Enter':
          if (state.view === 'mail' && state.activeId) void actions.openCompose('reply')
          break
        case 'e':
          if (state.activeId) {
            event.preventDefault()
            void actions.archive()
          }
          break
        case '#':
        case 'Delete':
          if (state.activeId) {
            event.preventDefault()
            void actions.trash()
          }
          break
        case 's':
          if (state.activeId) {
            event.preventDefault()
            const message = state.messages.find((entry) => entry.id === state.activeId)
            void actions.flag('isStarred', !message?.isStarred, [state.activeId])
          }
          break
        case 'u':
          if (state.messages.length > 0) void actions.refreshList()
          break
        case '?':
          event.preventDefault()
          actions.setView('settings', 'shortcuts')
          break
        case 'Escape':
          if (state.preview) actions.closeAttachment()
          else if (state.selectedIds.length > 0) actions.clearSelection()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [actions, state.activeId, state.compose, state.messages, state.paletteOpen, state.preview, state.selectedIds.length, state.view])
}
