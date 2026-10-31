/**
 * Novamail - add-account wizard.
 *
 * Gmail and Microsoft 365 use real OAuth 2.0 with PKCE in the system browser;
 * Novamail never shows a password form for providers that support OAuth. Other
 * providers use an app password. Server settings are always shown for review
 * before anything is saved, because autoconfiguration can be wrong.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { AccountDraftInput, ProviderId, ServerConfig } from '@shared/types'
import { PROVIDERS, PROVIDER_LIST } from '@shared/providers'
import type { AutoconfigResult } from '@shared/ipc'
import { api, errorMessage } from '../bridge'
import { useApp } from '../state/AppProvider'
import { Icon } from '../components/icons'
import { Banner, Button, Chip, Field, Modal, Spinner } from '../components/ui'

type Step = 'provider' | 'details' | 'servers' | 'review'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function SetupWizard(): ReactNode {
  const { state, actions } = useApp()
  const [step, setStep] = useState<Step>('provider')
  const [providerId, setProviderId] = useState<ProviderId>('gmail')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [imap, setImap] = useState<ServerConfig>(PROVIDERS.gmail.imap!)
  const [smtp, setSmtp] = useState<ServerConfig>(PROVIDERS.gmail.smtp!)
  const [discovery, setDiscovery] = useState<AutoconfigResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'discover' | 'test' | 'save' | 'oauth' | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; imap?: string; smtp?: string } | null>(null)

  const provider = PROVIDERS[providerId]
  const requiresOAuth = provider.authType === 'oauth2'
  const isFirstRun = state.accounts.length === 0

  const draft = useMemo<AccountDraftInput>(
    () => ({
      email: email.trim(),
      displayName: displayName.trim() || email.split('@')[0] || 'Me',
      providerId,
      authType: requiresOAuth ? 'oauth2' : 'password',
      username: username.trim() || email.trim(),
      imap,
      smtp,
      password: requiresOAuth ? undefined : password,
      oauthProvider: provider.oauthProvider
    }),
    [displayName, email, imap, password, provider.oauthProvider, providerId, requiresOAuth, smtp, username]
  )

  const pickProvider = (id: ProviderId): void => {
    setProviderId(id)
    const next = PROVIDERS[id]
    if (next.imap) setImap(next.imap)
    if (next.smtp) setSmtp(next.smtp)
    setDiscovery(null)
    setTestResult(null)
  }

  const discover = async (): Promise<void> => {
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError('Enter a complete email address, for example name@example.com.')
      return
    }
    setBusy('discover')
    setError(null)
    try {
      const result = await api.accounts.autoconfigure(email.trim())
      setDiscovery(result)
      pickProvider(result.providerId)
      setImap(result.imap)
      setSmtp(result.smtp)
      if (result.providerId === 'generic' && !result.confident) {
        setStep('servers')
      } else {
        setStep('details')
      }
    } catch (discoverError) {
      setError(errorMessage(discoverError))
      setStep('servers')
    } finally {
      setBusy(null)
    }
  }

  const startOAuth = async (): Promise<void> => {
    setBusy('oauth')
    setError(null)
    try {
      const result = await api.accounts.startOAuth({
        provider: provider.oauthProvider ?? 'google',
        loginHint: email.trim() || undefined
      })
      if (!result.ok) {
        if (result.cancelled) {
          actions.pushToast({
            tone: 'info',
            title: 'Sign-in cancelled',
            description: 'No account was added. You can start again whenever you are ready.'
          })
          return
        }
        setError(result.error ?? 'The sign-in did not complete.')
        return
      }
      await actions.refreshAccounts()
      await actions.refreshFolders()
      actions.setWizardOpen(false)
      actions.openMailbox('unified')
      actions.pushToast({
        tone: 'success',
        title: 'Account connected',
        description: `${result.account?.email ?? email} is synchronising now.`
      })
    } catch (oauthError) {
      setError(errorMessage(oauthError))
    } finally {
      setBusy(null)
    }
  }

  const test = async (): Promise<void> => {
    setBusy('test')
    setError(null)
    setTestResult(null)
    try {
      const result = await api.accounts.test(draft)
      setTestResult({
        ok: result.ok,
        imap: result.imap?.message ?? result.error,
        smtp: result.smtp?.message ?? result.error
      })
    } catch (testError) {
      setError(errorMessage(testError))
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    setBusy('save')
    setError(null)
    try {
      await api.accounts.create(draft)
      await actions.refreshAccounts()
      await actions.refreshFolders()
      actions.setWizardOpen(false)
      actions.openMailbox('unified')
      actions.pushToast({
        tone: 'success',
        title: 'Account added',
        description: `${draft.email} is synchronising. Large mailboxes can take a few minutes.`
      })
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setBusy(null)
    }
  }

  const stepIndex = ['provider', 'details', 'servers', 'review'].indexOf(step)

  return (
    <Modal
      title={isFirstRun ? 'Welcome to Novamail' : 'Add an account'}
      size="md"
      onClose={() => actions.setWizardOpen(false)}
      footer={
        <>
          <span className="modal__footer-note">
            {isFirstRun ? 'Step' : 'Adding account'} {stepIndex + 1} of 4
          </span>
          <span className="spacer" />
          {step !== 'provider' ? (
            <Button
              onClick={() => {
                setError(null)
                setStep(step === 'review' ? 'servers' : step === 'servers' ? 'details' : 'provider')
              }}
            >
              Back
            </Button>
          ) : null}
          {step === 'provider' ? (
            <Button variant="primary" onClick={() => void discover()} disabled={busy === 'discover'}>
              {busy === 'discover' ? 'Looking up your provider…' : 'Continue'}
            </Button>
          ) : null}
          {step === 'details' ? (
            <Button
              variant="primary"
              onClick={() => {
                setError(null)
                if (!EMAIL_PATTERN.test(draft.email)) {
                  setError('Enter a complete email address.')
                  return
                }
                if (!requiresOAuth && password.length === 0) {
                  setError('Enter your app password, or create one with your provider first.')
                  return
                }
                setStep('servers')
              }}
            >
              Continue
            </Button>
          ) : null}
          {step === 'servers' ? (
            <Button
              variant="primary"
              onClick={() => {
                setError(null)
                if (!imap.host.trim() || !smtp.host.trim()) {
                  setError('Both server names are required.')
                  return
                }
                setStep('review')
              }}
            >
              Continue
            </Button>
          ) : null}
          {step === 'review' ? (
            <Button variant="primary" onClick={() => void save()} disabled={busy === 'save'}>
              {busy === 'save' ? 'Adding the account…' : 'Add the account'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="wizard">
        <ol className="wizard__steps" aria-label="Progress">
          {['Address', 'Sign in', 'Servers', 'Review'].map((label, index) => (
            <li key={label} className={index <= stepIndex ? 'is-done' : ''} aria-current={index === stepIndex}>
              <span className="wizard__step-index">{index + 1}</span> {label}
            </li>
          ))}
        </ol>

        {error ? (
          <div className="banner banner--danger" role="alert">
            <Icon name="error" size={16} />
            <div>{error}</div>
          </div>
        ) : null}

        {step === 'provider' ? (
          <div className="stack" style={{ gap: 14 }}>
            <Field label="Your email address" hint="Novamail works out your provider from the address.">
              <input
                className="input input--lg"
                type="email"
                autoFocus
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void discover()}
              />
            </Field>

            <div>
              <div className="field__label">Or choose your provider</div>
              <div className="provider-grid">
                {PROVIDER_LIST.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`provider-card ${providerId === entry.id ? 'is-active' : ''}`}
                    aria-pressed={providerId === entry.id}
                    onClick={() => pickProvider(entry.id)}
                  >
                    <span className="provider-card__name">{entry.label}</span>
                    <span className="provider-card__meta">
                      {entry.authType === 'oauth2' ? 'Secure OAuth sign-in' : 'App password'}
                    </span>
                    {entry.capabilities.labels ? <Chip tone="accent">Labels</Chip> : null}
                  </button>
                ))}
              </div>
            </div>

            <Banner tone="info" icon="shield">
              Novamail connects straight to your provider over IMAP and SMTP with TLS. There is no Novamail account and no
              server in the middle.
            </Banner>
          </div>
        ) : null}

        {step === 'details' ? (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 8 }}>
              <Chip tone="accent">{provider.label}</Chip>
              <span className="small muted">{email || '(address not set)'}</span>
            </div>

            {requiresOAuth ? (
              <>
                <p className="small muted" style={{ lineHeight: 1.6 }}>
                  A browser window opens on {provider.oauthProvider === 'google' ? "Google's" : "Microsoft's"} own sign-in
                  page. Novamail waits for the result and stores only the token, encrypted with Windows DPAPI. Your password
                  is never typed into Novamail.
                </p>
                <Field label="Name to show recipients">
                  <input
                    className="input"
                    value={displayName}
                    placeholder="Anna Dorji"
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </Field>
                <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button variant="primary" icon="external" onClick={() => void startOAuth()} disabled={busy === 'oauth'}>
                    {busy === 'oauth'
                      ? 'Waiting for the browser…'
                      : `Sign in with ${provider.oauthProvider === 'google' ? 'Google' : 'Microsoft'}`}
                  </Button>
                  {busy === 'oauth' ? (
                    <Button
                      icon="close"
                      onClick={async () => {
                        await api.accounts.cancelOAuth().catch(() => undefined)
                      }}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
                <details className="small muted">
                  <summary>Use an app password instead (advanced)</summary>
                  <p style={{ lineHeight: 1.6 }}>
                    If your organisation blocks OAuth for desktop apps, you can continue with an app password. Novamail will
                    still use TLS for every connection.
                  </p>
                  <Button size="sm" onClick={() => { pickProvider(providerId); setStep('servers') }}>
                    Configure servers manually
                  </Button>
                </details>
              </>
            ) : (
              <>
                <Field label="Name to show recipients">
                  <input
                    className="input"
                    value={displayName}
                    placeholder="Anna Dorji"
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </Field>
                <Field label="Username" hint="Usually the full email address.">
                  <input
                    className="input"
                    value={username}
                    placeholder={email}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </Field>
                <Field
                  label="App password"
                  hint="Most providers require an app-specific password when two-step verification is on."
                >
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      className="input"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="off"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <Button size="sm" onClick={() => setShowPassword((value) => !value)}>
                      {showPassword ? 'Hide' : 'Show'}
                    </Button>
                  </div>
                </Field>
                {provider.appPasswordHelp ? (
                  <Button size="sm" icon="external" onClick={() => void api.app.openExternal(provider.appPasswordHelp!)}>
                    How to create an app password
                  </Button>
                ) : null}
                <ul className="checklist">
                  {provider.setupNotes.map((note) => (
                    <li key={note}>
                      <Icon name="info" size={14} /> {note}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : null}

        {step === 'servers' ? (
          <div className="stack" style={{ gap: 14 }}>
            {discovery ? (
              <Banner tone={discovery.confident ? 'info' : 'warning'} icon={discovery.confident ? 'check' : 'warning'}>
                {discovery.confident
                  ? 'Server settings were found automatically. Check them before continuing.'
                  : 'Settings could not be detected. Enter the server names your provider publishes.'}
              </Banner>
            ) : null}

            <ServerFields
              title="Incoming mail (IMAP)"
              value={imap}
              onChange={setImap}
              defaultPort={993}
              defaultSecure
            />
            <ServerFields title="Outgoing mail (SMTP)" value={smtp} onChange={setSmtp} defaultPort={587} />

            {discovery?.notes.length ? (
              <ul className="checklist">
                {discovery.notes.map((note) => (
                  <li key={note}>
                    <Icon name="info" size={14} /> {note}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="row" style={{ gap: 8 }}>
              <Button icon="refresh" onClick={() => void test()} disabled={busy === 'test'}>
                {busy === 'test' ? 'Testing…' : 'Test the connection'}
              </Button>
              {testResult ? (
                <div className="stack" style={{ gap: 4 }}>
                  <span className="small">
                    <Icon name={testResult.ok ? 'check' : 'warning'} size={14} /> IMAP: {testResult.imap}
                  </span>
                  <span className="small">
                    <Icon name={testResult.ok ? 'check' : 'warning'} size={14} /> SMTP: {testResult.smtp}
                  </span>
                </div>
              ) : null}
            </div>
            {busy === 'test' ? <Spinner label="Opening a secure connection" /> : null}
          </div>
        ) : null}

        {step === 'review' ? (
          <div className="stack" style={{ gap: 12 }}>
            <table className="data-table">
              <tbody>
                <tr>
                  <th scope="row">Account</th>
                  <td>{draft.email}</td>
                </tr>
                <tr>
                  <th scope="row">Name</th>
                  <td>{draft.displayName}</td>
                </tr>
                <tr>
                  <th scope="row">Provider</th>
                  <td>{provider.label}</td>
                </tr>
                <tr>
                  <th scope="row">Sign-in</th>
                  <td>
                    {requiresOAuth
                      ? `OAuth 2.0 (${provider.oauthProvider === 'google' ? 'Google' : 'Microsoft'})`
                      : 'App password'}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Incoming</th>
                  <td>
                    {imap.host}:{imap.port} {imap.secure ? 'SSL/TLS' : 'STARTTLS'}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Outgoing</th>
                  <td>
                    {smtp.host}:{smtp.port} {smtp.secure ? 'SSL/TLS' : 'STARTTLS'}
                  </td>
                </tr>
              </tbody>
            </table>

            <ul className="checklist">
              <li>
                <Icon name="info" size={14} /> {provider.capabilities.calendar === 'none'
                  ? 'Calendar events stay on this computer; this provider does not offer CalDAV.'
                  : 'Calendar and contacts can synchronise when your provider allows it.'}
              </li>
              <li>
                <Icon name="info" size={14} /> Messages are cached locally so you can read them offline.
              </li>
              <li>
                <Icon name="shield" size={14} /> Your password or token is encrypted with Windows DPAPI.
              </li>
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function ServerFields({
  title,
  value,
  onChange,
  defaultPort,
  defaultSecure = false
}: {
  title: string
  value: ServerConfig
  onChange: (value: ServerConfig) => void
  defaultPort: number
  defaultSecure?: boolean
}): ReactNode {
  return (
    <div className="settings-group">
      <div className="settings-group__title">{title}</div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <Field label="Server">
            <input className="input" value={value.host} onChange={(event) => onChange({ ...value, host: event.target.value })} />
          </Field>
        </div>
        <div style={{ width: 110 }}>
          <Field label="Port">
            <input
              className="input"
              type="number"
              min={1}
              max={65535}
              value={value.port || defaultPort}
              onChange={(event) => onChange({ ...value, port: Number(event.target.value) })}
            />
          </Field>
        </div>
        <label className="checkbox-row" style={{ paddingBottom: 6 }}>
          <input
            type="checkbox"
            checked={value.secure}
            onChange={(event) => onChange({ ...value, secure: event.target.checked })}
          />
          <span className="checkbox-row__text">
            <strong>SSL/TLS</strong>
            <span>{value.secure ? `Direct TLS on port ${value.port}` : `Upgrade with STARTTLS (default ${defaultSecure ? 'TLS' : 'STARTTLS'})`}</span>
          </span>
        </label>
      </div>
    </div>
  )
}
