/**
 * Novamail - settings.
 *
 * Every control writes through to the main process immediately; there is no
 * "apply" button to forget. Sections are keyboard reachable and labelled.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { Account, DiagnosticsReport, Folder } from '@shared/types'
import type { OAuthProviderStatus } from '@shared/ipc'
import { ACCOUNT_COLORS } from '@shared/providers'
import { api, errorMessage } from '../bridge'
import { useApp } from '../state/AppProvider'
import { Icon } from '../components/icons'
import {
  Button,
  Chip,
  ConfirmDialog,
  Field,
  IconButton,
  Modal,
  Segmented,
  Spinner,
  Toggle,
  formatRelative
} from '../components/ui'

const TABS = [
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'accounts', label: 'Accounts', icon: 'user' },
  { id: 'reading', label: 'Reading', icon: 'mail' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'compose', label: 'Writing', icon: 'compose' },
  { id: 'privacy', label: 'Privacy & security', icon: 'shield' },
  { id: 'sync', label: 'Synchronisation', icon: 'refresh' },
  { id: 'shortcuts', label: 'Keyboard', icon: 'keyboard' },
  { id: 'data', label: 'Data & backup', icon: 'save' },
  { id: 'about', label: 'About', icon: 'info' }
] as const

type TabId = (typeof TABS)[number]['id']

export function SettingsView(): ReactNode {
  const { state, actions } = useApp()
  const [tab, setTab] = useState<TabId>((state.settingsTab as TabId) ?? 'appearance')
  const settings = state.settings

  useEffect(() => {
    if (state.settingsTab) setTab(state.settingsTab as TabId)
  }, [state.settingsTab])

  if (!settings) return <Spinner large label="Loading settings" />

  return (
    <section className="panel settings" aria-label="Settings">
      <div className="settings__nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`settings-tab ${tab === entry.id ? 'is-active' : ''}`}
            onClick={() => {
              setTab(entry.id)
              if (entry.id === 'about') actions.setView('about')
            }}
          >
            <Icon name={entry.icon} size={17} />
            {entry.label}
          </button>
        ))}
      </div>

      <div className="settings__content">
        {tab === 'appearance' ? <AppearanceSettings /> : null}
        {tab === 'accounts' ? <AccountSettings /> : null}
        {tab === 'reading' ? <ReadingSettings /> : null}
        {tab === 'notifications' ? <NotificationSettings /> : null}
        {tab === 'compose' ? <ComposeSettingsPanel /> : null}
        {tab === 'privacy' ? <PrivacySettings /> : null}
        {tab === 'sync' ? <SyncSettings /> : null}
        {tab === 'shortcuts' ? <ShortcutSettings /> : null}
        {tab === 'data' ? <DataSettings /> : null}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ shared */

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }): ReactNode {
  return (
    <div className="settings-group">
      <div className="settings-group__title">{title}</div>
      {description ? <p className="settings-group__desc">{description}</p> : null}
      <div className="settings-group__body">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <strong>{label}</strong>
        {hint ? <span>{hint}</span> : null}
      </div>
      <div className="settings-row__control" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- appearance */

function AppearanceSettings(): ReactNode {
  const { state, actions } = useApp()
  const ui = state.settings!.ui

  return (
    <>
      <Section title="Theme" description="Novamail follows Windows by default. Your choice is remembered.">
        <Row label="Colour scheme">
          <Segmented
            value={ui.theme}
            onChange={(value) => void actions.updateSettings({ ui: { theme: value } })}
            options={[
              { value: 'system', label: 'Match Windows' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' }
            ]}
          />
        </Row>
        <Row label="Accent colour" hint="Used for highlights, focus rings and primary buttons.">
          <div className="swatches">
            {ACCOUNT_COLORS.map((colour) => (
              <button
                key={colour}
                type="button"
                className={`swatch ${ui.accent === colour ? 'is-active' : ''}`}
                style={{ background: colour }}
                aria-label={`Accent ${colour}`}
                aria-pressed={ui.accent === colour}
                onClick={() => void actions.updateSettings({ ui: { accent: colour } })}
              />
            ))}
          </div>
        </Row>
        <Row label="Surface depth" hint="Soft neumorphic surfaces, or flat panels for maximum clarity.">
          <Segmented
            value={ui.neumorphicIntensity}
            onChange={(value) => void actions.updateSettings({ ui: { neumorphicIntensity: value } })}
            options={[
              { value: 'flat', label: 'Flat' },
              { value: 'subtle', label: 'Subtle' },
              { value: 'premium', label: 'Premium' }
            ]}
          />
        </Row>
      </Section>

      <Section title="Text and layout">
        <Row label="Text size">
          <Segmented
            value={String(ui.textScale)}
            onChange={(value) => void actions.updateSettings({ ui: { textScale: Number(value) } })}
            options={[
              { value: '0.9', label: 'Small' },
              { value: '1', label: 'Standard' },
              { value: '1.15', label: 'Large' },
              { value: '1.3', label: 'Extra large' }
            ]}
          />
        </Row>
        <Row label="Message density">
          <Segmented
            value={ui.density}
            onChange={(value) => void actions.updateSettings({ ui: { density: value } })}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' }
            ]}
          />
        </Row>
        <Row label="Experience level" hint="Beginner mode keeps advanced controls out of the way.">
          <Segmented
            value={ui.experienceLevel}
            onChange={(value) => void actions.updateSettings({ ui: { experienceLevel: value } })}
            options={[
              { value: 'beginner', label: 'Beginner' },
              { value: 'advanced', label: 'Advanced' }
            ]}
          />
        </Row>
        <Toggle
          checked={ui.reduceMotion}
          onChange={(value) => void actions.updateSettings({ ui: { reduceMotion: value } })}
          label="Reduce motion"
          description="Turn off transitions and animated indicators."
        />
        <Toggle
          checked={ui.showSnippets}
          onChange={(value) => void actions.updateSettings({ ui: { showSnippets: value } })}
          label="Show message previews"
          description="Show the first lines of each message in the list."
        />
        <Row label="Sidebar width">
          <input
            type="range"
            min={180}
            max={320}
            value={ui.sidebarWidth}
            aria-label="Sidebar width"
            onChange={(event) => void actions.updateSettings({ ui: { sidebarWidth: Number(event.target.value) } })}
          />
        </Row>
        <Row label="Message list width">
          <input
            type="range"
            min={280}
            max={520}
            value={ui.listWidth}
            aria-label="Message list width"
            onChange={(event) => void actions.updateSettings({ ui: { listWidth: Number(event.target.value) } })}
          />
        </Row>
      </Section>
    </>
  )
}

/* ---------------------------------------------------------------- accounts */

function AccountSettings(): ReactNode {
  const { state, actions } = useApp()
  const [removing, setRemoving] = useState<Account | null>(null)
  const [editing, setEditing] = useState<Account | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})
  /** account id currently waiting for the browser to come back */
  const [signingIn, setSigningIn] = useState<string | null>(null)
  const [signInError, setSignInError] = useState<Record<string, string>>({})
  const [providers, setProviders] = useState<OAuthProviderStatus[]>([])
  const [editingProvider, setEditingProvider] = useState<'google' | 'microsoft' | null>(null)
  const [clientIdDraft, setClientIdDraft] = useState('')
  const [tenantDraft, setTenantDraft] = useState('common')
  const [savingProvider, setSavingProvider] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.accounts
      .oauthStatus()
      .then((status) => {
        if (!cancelled) setProviders(status)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const providerFor = (account: Account): 'google' | 'microsoft' | null =>
    account.authType === 'oauth2' ? account.oauthProvider : null

  const providerConfigured = (provider: 'google' | 'microsoft' | null): boolean =>
    provider ? Boolean(providers.find((entry) => entry.provider === provider)?.configured) : false

  const providerLabel = (provider: 'google' | 'microsoft'): string =>
    provider === 'google' ? 'Google' : 'Microsoft'

  /**
   * Re-runs the provider's OAuth flow for one account. The provider page opens
   * in the system browser; Novamail only receives the authorisation code on its
   * loopback listener, so this keeps working while the app is in the background.
   */
  const reconnect = async (account: Account): Promise<void> => {
    setSigningIn(account.id)
    setSignInError((current) => ({ ...current, [account.id]: '' }))
    try {
      const result = await api.accounts.reconnect(account.id)
      if (result.ok) {
        await actions.refreshAccounts()
        actions.pushToast({
          tone: 'success',
          title: `${account.email} is connected`,
          description: 'Sign-in finished and new mail will sync normally.'
        })
      } else if (result.cancelled) {
        actions.pushToast({
          tone: 'info',
          title: 'Sign-in cancelled',
          description: 'Nothing was changed. You can sign in again at any time.'
        })
      } else {
        setSignInError((current) => ({
          ...current,
          [account.id]: result.error ?? 'The sign-in did not complete.'
        }))
      }
    } catch (error) {
      setSignInError((current) => ({ ...current, [account.id]: errorMessage(error) }))
    } finally {
      setSigningIn(null)
    }
  }

  const saveProvider = async (provider: 'google' | 'microsoft'): Promise<void> => {
    setSavingProvider(true)
    try {
      const status = await api.accounts.setOAuthClient({
        provider,
        clientId: clientIdDraft.trim(),
        tenant: provider === 'microsoft' ? tenantDraft.trim() || 'common' : undefined
      })
      setProviders(status)
      setEditingProvider(null)
      setClientIdDraft('')
      actions.pushToast({
        tone: 'success',
        title: `${providerLabel(provider)} sign-in is configured`,
        description: 'You can now connect or reconnect accounts from this screen.'
      })
    } catch (error) {
      actions.pushToast({ tone: 'error', title: `Could not save the ${providerLabel(provider)} client ID`, description: errorMessage(error) })
    } finally {
      setSavingProvider(false)
    }
  }

  return (
    <>
      <Section
        title="Your accounts"
        description="Novamail talks directly to your mail provider over IMAP and SMTP. Nothing passes through a Novamail server."
      >
        {state.accounts.length === 0 ? <p className="muted">No accounts yet.</p> : null}
        <div className="stack" style={{ gap: 12 }}>
          {state.accounts.map((account) => (
            <div key={account.id} className="account-card">
              <div className="row" style={{ gap: 10 }}>
                <span className="account-dot account-dot--lg" style={{ background: account.color }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <strong className="truncate">{account.displayName}</strong>
                    {account.isDefault ? <Chip tone="accent">Default</Chip> : null}
                    <Chip
                      tone={
                        account.syncState === 'error' || account.syncState === 'auth-required'
                          ? 'danger'
                          : account.syncState === 'syncing'
                            ? 'accent'
                            : 'default'
                      }
                    >
                      {account.syncState === 'auth-required' ? 'Sign in needed' : account.syncState}
                    </Chip>
                  </div>
                  <div className="small muted truncate">
                    {account.email} • {account.providerId} • {account.authType === 'oauth2' ? 'OAuth 2.0' : 'app password'}
                  </div>
                  <div className="small muted">
                    IMAP {account.imap.host}:{account.imap.port} • SMTP {account.smtp.host}:{account.smtp.port} • last sync{' '}
                    {formatRelative(account.lastSyncAt)}
                  </div>
                  {account.lastError ? <div className="field__error">{account.lastError}</div> : null}
                  {signingIn === account.id ? (
                    <div className="small" role="status" aria-live="polite">
                      <Spinner /> Finish signing in on the page that just opened in your browser. This screen updates on
                      its own when you are done.
                    </div>
                  ) : null}
                  {signInError[account.id] ? (
                    <div className="field__error" role="alert">
                      {signInError[account.id]}
                    </div>
                  ) : null}
                  {providerFor(account) && !providerConfigured(providerFor(account)) ? (
                    <div className="small muted">
                      {providerLabel(providerFor(account)!)} sign-in is not set up on this computer yet. Add an OAuth
                      client ID below, then choose Reconnect.
                    </div>
                  ) : null}
                  {testResult[account.id] ? <div className="small">{testResult[account.id]}</div> : null}
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  icon="refresh"
                  disabled={testing === account.id}
                  onClick={async () => {
                    setTesting(account.id)
                    try {
                      const result = await api.accounts.test({
                        id: account.id,
                        email: account.email,
                        displayName: account.displayName,
                        providerId: account.providerId,
                        authType: account.authType,
                        username: account.username,
                        imap: account.imap,
                        smtp: account.smtp,
                        oauthProvider: account.oauthProvider
                      })
                      setTestResult((current) => ({
                        ...current,
                        [account.id]: result.ok
                          ? `Connection OK. ${result.imap?.message ?? ''} ${result.smtp?.message ?? ''}`.trim()
                          : result.error ?? 'The connection test failed.'
                      }))
                    } catch (error) {
                      setTestResult((current) => ({ ...current, [account.id]: errorMessage(error) }))
                    } finally {
                      setTesting(null)
                    }
                  }}
                >
                  {testing === account.id ? 'Testing…' : 'Test connection'}
                </Button>
                <Button size="sm" icon="settings" onClick={() => setEditing(account)}>
                  Edit
                </Button>
                {!account.isDefault ? (
                  <Button
                    size="sm"
                    onClick={async () => {
                      await api.accounts.setDefault(account.id)
                      await actions.refreshAccounts()
                    }}
                  >
                    Make default
                  </Button>
                ) : null}
                {providerFor(account) ? (
                  <Button
                    size="sm"
                    variant={account.syncState === 'auth-required' ? 'primary' : 'default'}
                    icon="refresh"
                    disabled={signingIn !== null}
                    onClick={() => void reconnect(account)}
                  >
                    {signingIn === account.id
                      ? 'Waiting for your browser…'
                      : account.syncState === 'auth-required'
                        ? `Sign in again with ${providerLabel(providerFor(account)!)}`
                        : 'Reconnect'}
                  </Button>
                ) : null}
                {signingIn === account.id ? (
                  <Button
                    size="sm"
                    icon="close"
                    onClick={async () => {
                      await api.accounts.cancelOAuth().catch(() => undefined)
                      setSigningIn(null)
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                {account.authType === 'oauth2' ? (
                  <Button
                    size="sm"
                    icon="logout"
                    onClick={async () => {
                      try {
                        await api.accounts.revokeOAuth(account.id)
                        await actions.refreshAccounts()
                        actions.pushToast({ tone: 'success', title: 'Access revoked', description: 'Sign in again to reconnect.' })
                      } catch (error) {
                        actions.pushToast({ tone: 'error', title: 'Could not revoke access', description: errorMessage(error) })
                      }
                    }}
                  >
                    Revoke access
                  </Button>
                ) : null}
                <span className="spacer" />
                <Button size="sm" variant="danger" icon="trash" onClick={() => setRemoving(account)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button variant="primary" icon="plus" onClick={() => actions.setWizardOpen(true)}>
          Add another account
        </Button>
      </Section>

      <Section title="Sign-in privacy">
        <ul className="checklist">
          <li>
            <Icon name="shield" size={15} /> Novamail never asks for a Gmail or Microsoft password. Those providers use their
            own secure sign-in page, and Novamail receives only a token you can revoke at any time.
          </li>
          <li>
            <Icon name="shield" size={15} /> Tokens and app passwords are encrypted with Windows DPAPI and never leave this
            computer.
          </li>
          <li>
            <Icon name="info" size={15} /> OAuth client IDs belong to the person or organisation that publishes the build.
            See the account setup guide for how to register one.
          </li>
        </ul>
      </Section>

      {removing ? (
        <ConfirmDialog
          title={`Remove ${removing.email}?`}
          message="The account, its cached mail and its saved credentials are deleted from this computer. Mail on the server is not touched."
          confirmLabel="Remove the account"
          destructive
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await api.accounts.remove(removing.id)
              await actions.refreshAccounts()
              await actions.refreshFolders()
              actions.pushToast({ tone: 'success', title: 'Account removed' })
            } catch (error) {
              actions.pushToast({ tone: 'error', title: 'Could not remove the account', description: errorMessage(error) })
            } finally {
              setRemoving(null)
            }
          }}
        />
      ) : null}

      {editing ? (
        <EditAccountDialog
          account={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await actions.refreshAccounts()
          }}
        />
      ) : null}

      <Section
        title="Sign-in providers (OAuth)"
        description="Google and Microsoft sign-in uses each provider's own page in your default browser. Novamail never sees your password and never stores one."
      >
        {providers.length > 0 ? (
          providers.map((entry) => (
            <div className="stack" key={entry.provider} style={{ gap: 8 }}>
              <Row
                label={`${providerLabel(entry.provider)} client ID`}
                hint={
                  entry.configured
                    ? `Configured — app ID ending in ${entry.clientId ?? '…'}. Accounts can sign in.`
                    : 'Not configured yet. Create an OAuth client in the provider console and paste its client ID here.'
                }
              >
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <Chip tone={entry.configured ? 'success' : 'warning'}>
                    {entry.configured ? 'Ready' : 'Not configured'}
                  </Chip>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="settings"
                    onClick={() => {
                      setEditingProvider(entry.provider)
                      setClientIdDraft('')
                      setTenantDraft(entry.tenant ?? 'common')
                    }}
                  >
                    {entry.configured ? 'Change' : 'Set up'}
                  </Button>
                </div>
              </Row>
              {editingProvider === entry.provider ? (
                <div className="stack" style={{ gap: 8 }}>
                  <Field label={`${providerLabel(entry.provider)} OAuth client ID`} hint="Public application ID — it is not a secret.">
                    <input
                      className="input"
                      value={clientIdDraft}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={entry.provider === 'google' ? '1234567890-abc.apps.googleusercontent.com' : '00000000-0000-0000-0000-000000000000'}
                      onChange={(event) => setClientIdDraft(event.target.value)}
                    />
                  </Field>
                  {entry.provider === 'microsoft' ? (
                    <Field label="Directory (tenant)" hint="Use “common” for work, school and personal accounts, or your tenant ID.">
                      <input
                        className="input"
                        value={tenantDraft}
                        spellCheck={false}
                        autoComplete="off"
                        placeholder="common"
                        onChange={(event) => setTenantDraft(event.target.value)}
                      />
                    </Field>
                  ) : null}
                  <p className="small muted">
                    Redirect address for {providerLabel(entry.provider)}:{' '}
                    <code>{entry.provider === 'google' ? 'http://127.0.0.1:<port>/oauth/callback' : 'http://localhost:<port>'}</code>
                    {entry.provider === 'google'
                      ? ' — register it as a Desktop app redirect (loopback IP).'
                      : ' — register it as a Mobile and desktop application platform.'}
                  </p>
                  <div className="row" style={{ gap: 8 }}>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={savingProvider || clientIdDraft.trim().length < 8}
                      onClick={() => void saveProvider(entry.provider)}
                    >
                      {savingProvider ? 'Saving…' : 'Save client ID'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditingProvider(null); setClientIdDraft('') }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <p className="muted">Reading sign-in settings…</p>
        )}
      </Section>
    </>
  )
}

/**
 * Editing an existing account. Passwords for OAuth accounts are not editable
 * here - those accounts have none - so the dialog says how to sign in again
 * instead of showing a field that cannot work.
 */
function EditAccountDialog({
  account,
  onClose,
  onSaved
}: {
  account: Account
  onClose: () => void
  onSaved: () => Promise<void>
}): ReactNode {
  const [displayName, setDisplayName] = useState(account.displayName)
  const [username, setUsername] = useState(account.username)
  const [imapHost, setImapHost] = useState(account.imap.host)
  const [imapPort, setImapPort] = useState(String(account.imap.port))
  const [imapSecure, setImapSecure] = useState(account.imap.secure)
  const [smtpHost, setSmtpHost] = useState(account.smtp.host)
  const [smtpPort, setSmtpPort] = useState(String(account.smtp.port))
  const [smtpSecure, setSmtpSecure] = useState(account.smtp.secure)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isPasswordAccount = account.authType === 'password'

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.accounts.update({
        id: account.id,
        email: account.email,
        displayName: displayName.trim() || account.email.split('@')[0]!,
        providerId: account.providerId,
        authType: account.authType,
        username: username.trim() || account.email,
        imap: { host: imapHost.trim(), port: Number(imapPort), secure: imapSecure },
        smtp: { host: smtpHost.trim(), port: Number(smtpPort), secure: smtpSecure },
        ...(isPasswordAccount && password ? { password } : {})
      })
      await onSaved()
    } catch (updateError) {
      setError(errorMessage(updateError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Edit ${account.email}`}
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Name to show recipients">
          <input className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </Field>
        <Field label="Username" hint="Usually the full email address.">
          <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} />
        </Field>
        <p className="small muted" style={{ margin: 0 }}>
          The address itself cannot be changed. Add the new address as its own account and remove this one.
        </p>

        <h4 style={{ margin: '4px 0 0', fontSize: 14 }}>Incoming mail (IMAP)</h4>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Server">
            <input className="input" value={imapHost} onChange={(event) => setImapHost(event.target.value)} />
          </Field>
          <Field label="Port">
            <input className="input" value={imapPort} inputMode="numeric" style={{ width: 90 }} onChange={(event) => setImapPort(event.target.value.replace(/[^0-9]/g, ''))} />
          </Field>
          <Toggle checked={imapSecure} onChange={setImapSecure} label="SSL/TLS" />
        </div>

        <h4 style={{ margin: '4px 0 0', fontSize: 14 }}>Outgoing mail (SMTP)</h4>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Server">
            <input className="input" value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} />
          </Field>
          <Field label="Port">
            <input className="input" value={smtpPort} inputMode="numeric" style={{ width: 90 }} onChange={(event) => setSmtpPort(event.target.value.replace(/[^0-9]/g, ''))} />
          </Field>
          <Toggle checked={smtpSecure} onChange={setSmtpSecure} label="SSL/TLS" />
        </div>

        {isPasswordAccount ? (
          <Field label="New password or app password" hint="Leave blank to keep the current one.">
            <input
              className="input"
              type="password"
              value={password}
              autoComplete="new-password"
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            This account uses {account.oauthProvider === 'microsoft' ? 'Microsoft' : 'Google'} sign-in, so there is no
            password to store. Use “{account.syncState === 'auth-required' ? 'Sign in again' : 'Reconnect'}” on the
            account row to refresh access.
          </p>
        )}

        {error ? (
          <div className="field__error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------- reading */

function ReadingSettings(): ReactNode {
  const { state, actions } = useApp()
  const ui = state.settings!.ui
  const privacy = state.settings!.privacy

  return (
    <>
      <Section title="Reading pane">
        <Row label="Position" hint="Hide the pane for a distraction-free list, or put it below the list.">
          <Segmented
            value={ui.readingPane}
            onChange={(value) => void actions.updateSettings({ ui: { readingPane: value } })}
            options={[
              { value: 'right', label: 'Right' },
              { value: 'bottom', label: 'Bottom' },
              { value: 'hidden', label: 'Hidden' }
            ]}
          />
        </Row>
        <Toggle
          checked={ui.conversationView}
          onChange={(value) => void actions.updateSettings({ ui: { conversationView: value } })}
          label="Group messages into conversations"
          description="Messages that belong to the same thread are kept together."
        />
      </Section>

      <Section title="Remote content" description="Remote images let senders see when and where you opened a message.">
        <Toggle
          checked={privacy.blockRemoteImages}
          onChange={(value) => void actions.updateSettings({ privacy: { blockRemoteImages: value } })}
          label="Block remote images by default"
          description="You can still show them for a single message with one click."
        />
        <Toggle
          checked={privacy.warnOnExternalLinks}
          onChange={(value) => void actions.updateSettings({ privacy: { warnOnExternalLinks: value } })}
          label="Ask before opening links"
          description="Shows the address before Windows opens your browser."
        />
        <Toggle
          checked={privacy.allowReadReceipts}
          onChange={(value) => void actions.updateSettings({ privacy: { allowReadReceipts: value } })}
          label="Answer read-receipt requests"
          description="When off, Novamail never tells senders that you read a message."
        />
      </Section>

      <Section title="Attachments">
        <Toggle
          checked={state.settings!.attachmentPreview.enabled}
          onChange={(value) => void actions.updateSettings({ attachmentPreview: { enabled: value } })}
          label="Preview attachments inside Novamail"
          description="PDF, pictures, text, CSV, audio and video are previewed from the local cache."
        />
        <Toggle
          checked={state.settings!.attachmentPreview.officePreviews}
          onChange={(value) => void actions.updateSettings({ attachmentPreview: { officePreviews: value } })}
          label="Preview Office documents locally"
          description="DOCX, XLSX and PPTX are converted on this computer. Nothing is uploaded."
        />
        <Row label="Preview size limit" hint="Larger files can still be saved and opened externally.">
          <Segmented
            value={String(Math.round(state.settings!.attachmentPreview.maxPreviewBytes / (1024 * 1024)))}
            onChange={(value) =>
              void actions.updateSettings({ attachmentPreview: { maxPreviewBytes: Number(value) * 1024 * 1024 } })
            }
            options={[
              { value: '10', label: '10 MB' },
              { value: '25', label: '25 MB' },
              { value: '50', label: '50 MB' }
            ]}
          />
        </Row>
        <Row label="Site the flags that matter" hint="Dangerous file types are always labelled.">
          <Toggle
            checked={privacy.warnDangerousAttachments}
            onChange={(value) => void actions.updateSettings({ privacy: { warnDangerousAttachments: value } })}
            label="Highlight attachments that can run code"
            description="Executables and macro documents are never opened automatically."
          />
        </Row>
      </Section>
    </>
  )
}

/* ----------------------------------------------------------- notifications */

function NotificationSettings(): ReactNode {
  const { state, actions } = useApp()
  const settings = state.settings!

  return (
    <>
      <Section title="Notifications">
        <Toggle
          checked={settings.notifications.enabled}
          onChange={(value) => void actions.updateSettings({ notifications: { enabled: value } })}
          label="Show Windows notifications for new mail"
        />
        <Toggle
          checked={settings.notifications.desktopPreview}
          onChange={(value) => void actions.updateSettings({ notifications: { desktopPreview: value } })}
          label="Include the sender and subject"
          description="Turn this off if you share your screen."
        />
        <Toggle
          checked={settings.notifications.sound}
          onChange={(value) => void actions.updateSettings({ notifications: { sound: value } })}
          label="Play a sound"
        />
        <Toggle
          checked={settings.notifications.onlyImportant}
          onChange={(value) => void actions.updateSettings({ notifications: { onlyImportant: value } })}
          label="Only for important messages"
        />
      </Section>

      <Section title="Quiet hours" description="Notifications are silent during quieter hours. Leave blank to disable.">
        <Row label="From">
          <input
            className="input"
            type="time"
            value={settings.notifications.quietHoursStart ?? ''}
            onChange={(event) =>
              void actions.updateSettings({ notifications: { quietHoursStart: event.target.value || null } })
            }
            aria-label="Quiet hours start"
          />
        </Row>
        <Row label="Until">
          <input
            className="input"
            type="time"
            value={settings.notifications.quietHoursEnd ?? ''}
            onChange={(event) => void actions.updateSettings({ notifications: { quietHoursEnd: event.target.value || null } })}
            aria-label="Quiet hours end"
          />
        </Row>
      </Section>

      <Section title="Windows integration">
        <Toggle
          checked={settings.minimizeToTray}
          onChange={(value) => void actions.updateSettings({ minimizeToTray: value })}
          label="Keep running in the notification area"
          description="Novamail keeps checking for mail and can still show notifications."
        />
        <Toggle
          checked={settings.launchAtStartup}
          onChange={(value) => void actions.updateSettings({ launchAtStartup: value })}
          label="Start Novamail when I sign in to Windows"
        />
      </Section>
    </>
  )
}

/* ----------------------------------------------------------------- writing */

function ComposeSettingsPanel(): ReactNode {
  const { state, actions } = useApp()
  const settings = state.settings!

  return (
    <>
      <Section title="Sending">
        <Row label="Undo send window" hint="Set to 0 to send immediately. Messages wait in the outbox until the window ends.">
          <Segmented
            value={String(settings.compose.undoSendSeconds)}
            onChange={(value) => void actions.updateSettings({ compose: { undoSendSeconds: Number(value) } })}
            options={[
              { value: '0', label: 'Off' },
              { value: '5', label: '5 s' },
              { value: '10', label: '10 s' },
              { value: '20', label: '20 s' }
            ]}
          />
        </Row>
        <Row label="Draft autosave">
          <Segmented
            value={String(settings.compose.autoSaveDraftSeconds)}
            onChange={(value) => void actions.updateSettings({ compose: { autoSaveDraftSeconds: Number(value) } })}
            options={[
              { value: '10', label: '10 s' },
              { value: '20', label: '20 s' },
              { value: '60', label: '1 min' }
            ]}
          />
        </Row>
        <Row label="Reply button behaviour">
          <Segmented
            value={settings.compose.defaultReplyBehaviour}
            onChange={(value) => void actions.updateSettings({ compose: { defaultReplyBehaviour: value } })}
            options={[
              { value: 'reply', label: 'Reply to sender' },
              { value: 'replyAll', label: 'Reply to everyone' }
            ]}
          />
        </Row>
        <Toggle
          checked={settings.compose.signatureAboveQuote}
          onChange={(value) => void actions.updateSettings({ compose: { signatureAboveQuote: value } })}
          label="Place the signature above the quoted message"
        />
        <Toggle
          checked={settings.compose.spellcheck}
          onChange={(value) => void actions.updateSettings({ compose: { spellcheck: value } })}
          label="Check spelling while typing"
        />
        <Toggle
          checked={settings.privacy.requestReadReceipts}
          onChange={(value) => void actions.updateSettings({ privacy: { requestReadReceipts: value } })}
          label="Request read receipts by default"
        />
      </Section>

      <Section title="Default account">
        <Row label="Send new messages from">
          <select
            className="select"
            value={settings.defaultAccountId ?? ''}
            onChange={(event) => void actions.updateSettings({ defaultAccountId: event.target.value || null })}
            aria-label="Default account"
          >
            {state.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.email}
              </option>
            ))}
          </select>
        </Row>
      </Section>
    </>
  )
}

/* ----------------------------------------------------------------- privacy */

function PrivacySettings(): ReactNode {
  const { state, actions } = useApp()
  const settings = state.settings!
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState<number | null>(null)

  return (
    <>
      <Section title="Message safety">
        <Toggle
          checked={settings.privacy.blockRemoteImages}
          onChange={(value) => void actions.updateSettings({ privacy: { blockRemoteImages: value } })}
          label="Block remote images"
        />
        <Toggle
          checked={settings.privacy.blockRemoteImagesUnknownSenders}
          onChange={(value) => void actions.updateSettings({ privacy: { blockRemoteImagesUnknownSenders: value } })}
          label="Always block images from unknown senders"
          description="Even when you choose to show images for a message."
        />
        <Toggle
          checked={settings.privacy.warnOnExternalLinks}
          onChange={(value) => void actions.updateSettings({ privacy: { warnOnExternalLinks: value } })}
          label="Ask before opening external links"
        />
        <Toggle
          checked={settings.privacy.warnDangerousAttachments}
          onChange={(value) => void actions.updateSettings({ privacy: { warnDangerousAttachments: value } })}
          label="Flag dangerous attachments"
        />
        <Toggle
          checked={settings.privacy.sendDeliveryReceipts}
          onChange={(value) => void actions.updateSettings({ privacy: { sendDeliveryReceipts: value } })}
          label="Answer delivery-receipt requests"
          description="Delivery receipts are not read receipts: they confirm the message reached the server."
        />
      </Section>

      <Section title="Local data">
        <Row
          label="Credential protection"
          hint="Windows Data Protection API (DPAPI), bound to your Windows account."
        >
          <Chip tone={state.info?.credentialStorage === 'os-encrypted' ? 'success' : 'warning'}>
            {state.info?.credentialStorage === 'os-encrypted' ? 'Protected by Windows' : 'Fallback store in use'}
          </Chip>
        </Row>
        <Row label="Temporary attachment files" hint="Cached previews are removed after this many days.">
          <Segmented
            value={String(settings.privacy.autoDeleteTempFilesDays)}
            onChange={(value) => void actions.updateSettings({ privacy: { autoDeleteTempFilesDays: Number(value) } })}
            options={[
              { value: '1', label: '1 day' },
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '0', label: 'Keep' }
            ]}
          />
        </Row>
        <Row label="Attachment cache">
          <Button
            icon="trash"
            disabled={clearing}
            onClick={async () => {
              setClearing(true)
              try {
                const removed = await api.attachments.clearCache()
                setCleared(removed)
                actions.pushToast({ tone: 'success', title: 'Cache cleared', description: `${removed} files removed` })
              } catch (error) {
                actions.pushToast({ tone: 'error', title: 'Cache could not be cleared', description: errorMessage(error) })
              } finally {
                setClearing(false)
              }
            }}
          >
            {clearing ? 'Clearing…' : 'Clear the cache now'}
          </Button>
        </Row>
        {cleared !== null ? <p className="small muted">{cleared} cached files were removed.</p> : null}
        <p className="small muted">
          Novamail does not offer end-to-end encryption. Messages are protected in transit by TLS and stored locally in your
          Windows profile.
        </p>
      </Section>
    </>
  )
}

/* -------------------------------------------------------------------- sync */

function SyncSettings(): ReactNode {
  const { state, actions } = useApp()
  const settings = state.settings!
  const [folders, setFolders] = useState<Folder[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.folders.list().then(setFolders).catch(() => setFolders([]))
  }, [state.folders])

  return (
    <>
      <Section title="Synchronisation">
        <Row label="Check for new mail every">
          <Segmented
            value={String(settings.sync.intervalMinutes)}
            onChange={(value) => void actions.updateSettings({ sync: { intervalMinutes: Number(value) } })}
            options={[
              { value: '1', label: '1 min' },
              { value: '5', label: '5 min' },
              { value: '15', label: '15 min' },
              { value: '60', label: 'Hourly' }
            ]}
          />
        </Row>
        <Toggle
          checked={settings.sync.useIdle}
          onChange={(value) => void actions.updateSettings({ sync: { useIdle: value } })}
          label="Use server push (IMAP IDLE)"
          description="New mail arrives immediately when your provider supports it."
        />
        <Row label="Offline mode" hint={state.syncStatus?.offline ? 'Novamail is working from the local cache.' : 'Connected.'}>
          <Button onClick={() => void actions.setOffline(!state.syncStatus?.offline)}>
            {state.syncStatus?.offline ? 'Go online' : 'Work offline'}
          </Button>
        </Row>
        {state.syncStatus && state.syncStatus.queuedOperations > 0 ? (
          <div className="banner banner--warning">
            <Icon name="info" size={16} />
            <div>
              {state.syncStatus.queuedOperations} change(s) are waiting to reach the server. Nothing is lost; they retry
              automatically.
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Offline cache">
        <Row label="Messages kept per folder" hint="Older mail stays on the server and is fetched on demand.">
          <Segmented
            value={String(settings.sync.maxCachedMessagesPerFolder)}
            onChange={(value) => void actions.updateSettings({ sync: { maxCachedMessagesPerFolder: Number(value) } })}
            options={[
              { value: '500', label: '500' },
              { value: '2000', label: '2 000' },
              { value: '5000', label: '5 000' }
            ]}
          />
        </Row>
        <Toggle
          checked={settings.sync.downloadAttachmentsOnDemandOnly}
          onChange={(value) => void actions.updateSettings({ sync: { downloadAttachmentsOnDemandOnly: value } })}
          label="Download attachments only when I open them"
          description="Saves disk space and data on metered connections."
        />
      </Section>

      <Section title="Folders" description="Folders come from your mail server. Novamail follows changes automatically.">
        <div className="stack" style={{ gap: 4, maxHeight: 240, overflow: 'auto' }}>
          {folders.map((folder) => (
            <div key={folder.id} className="row" style={{ gap: 8 }}>
              <Icon name="folder" size={15} />
              <span className="truncate" style={{ flex: 1 }}>
                {folder.path}
              </span>
              <span className="small muted">{folder.kind}</span>
              <IconButton
                icon="refresh"
                label={`Re-synchronise ${folder.name}`}
                size={14}
                onClick={async () => {
                  setBusy(true)
                  await actions.syncNow(folder.accountId)
                  setBusy(false)
                }}
              />
            </div>
          ))}
        </div>
        {busy ? <Spinner label="Synchronising" /> : null}
      </Section>
    </>
  )
}

/* --------------------------------------------------------------- shortcuts */

function ShortcutSettings(): ReactNode {
  const { state } = useApp()
  const shortcuts = state.settings!.keyboardShortcuts
  return (
    <Section
      title="Keyboard shortcuts"
      description="Novamail follows Windows conventions. Every action is also available in the command palette (Ctrl+Shift+K)."
    >
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Shortcut</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(shortcuts).map(([action, shortcut]) => (
            <tr key={action}>
              <td>{action.replace(/\./g, ' › ')}</td>
              <td>
                <kbd className="kbd">{shortcut}</kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

/* -------------------------------------------------------------------- data */

function DataSettings(): ReactNode {
  const { state, actions } = useApp()
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  return (
    <>
      <Section
        title="Backup"
        description="A backup contains your local mail, folders, contacts, calendar, tasks, rules and settings. Passwords and tokens are never included."
      >
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button
            icon="save"
            disabled={busy === 'export'}
            onClick={async () => {
              setBusy('export')
              try {
                const result = await api.backup.exportAll()
                if (result.ok) {
                  actions.pushToast({
                    tone: 'success',
                    title: 'Backup created',
                    description: result.path,
                    durationMs: 8000
                  })
                }
              } catch (error) {
                actions.pushToast({ tone: 'error', title: 'Backup failed', description: errorMessage(error) })
              } finally {
                setBusy(null)
              }
            }}
          >
            {busy === 'export' ? 'Preparing…' : 'Create a backup'}
          </Button>
          <Button
            icon="upload"
            disabled={busy === 'import'}
            onClick={async () => {
              setBusy('import')
              try {
                const result = await api.backup.importAll()
                if (result.ok) {
                  actions.pushToast({
                    tone: 'success',
                    title: 'Backup restored',
                    description: 'Restart Novamail to load everything.'
                  })
                  await actions.refreshAccounts()
                  await actions.refreshFolders()
                } else if (result.error) {
                  actions.pushToast({ tone: 'error', title: 'Restore failed', description: result.error })
                }
              } catch (error) {
                actions.pushToast({ tone: 'error', title: 'Restore failed', description: errorMessage(error) })
              } finally {
                setBusy(null)
              }
            }}
          >
            {busy === 'import' ? 'Restoring…' : 'Restore a backup'}
          </Button>
        </div>
      </Section>

      <Section title="Diagnostics" description="A report helps support without revealing your message content.">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button
            icon="info"
            onClick={async () => {
              try {
                setDiagnostics(await api.app.diagnostics())
              } catch (error) {
                actions.pushToast({ tone: 'error', title: 'Diagnostics unavailable', description: errorMessage(error) })
              }
            }}
          >
            Build a diagnostics report
          </Button>
          <Button icon="folder" onClick={() => void api.app.openLogsFolder()}>
            Open the log folder
          </Button>
        </div>
        {diagnostics ? (
          <div className="stack">
            <div className="small muted">
              {diagnostics.database?.messages ?? 0} messages • {diagnostics.database?.folders ?? 0} folders •{' '}
              {Math.round((diagnostics.database?.sizeBytes ?? 0) / 1024)} KB
            </div>
            <textarea
              className="textarea mono"
              readOnly
              rows={8}
              value={JSON.stringify(diagnostics, null, 2)}
              aria-label="Diagnostics report"
            />
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
                actions.pushToast({ tone: 'success', title: 'Copied to the clipboard' })
              }}
            >
              Copy the report
            </Button>
          </div>
        ) : null}
      </Section>

      <Section title="Reset">
        <Row label="Reset settings" hint="Accounts, messages and drafts are not touched.">
          <Button variant="danger" onClick={() => setConfirmReset(true)}>
            Reset to defaults
          </Button>
        </Row>
        <Row label="Version" hint={state.info?.isPackaged ? 'Installed build' : 'Development build'}>
          <span className="mono">{state.info?.version}</span>
        </Row>
      </Section>

      {confirmReset ? (
        <ConfirmDialog
          title="Reset every setting?"
          message="Appearance, notifications, privacy and layout return to their defaults. Your accounts and mail are kept."
          confirmLabel="Reset settings"
          destructive
          onCancel={() => setConfirmReset(false)}
          onConfirm={async () => {
            setConfirmReset(false)
            try {
              await api.settings.reset()
              const settings = await api.settings.get()
              actions.pushToast({ tone: 'success', title: 'Settings reset' })
              void settings
              await actions.refreshList()
            } catch (error) {
              actions.pushToast({ tone: 'error', title: 'Reset failed', description: errorMessage(error) })
            }
          }}
        />
      ) : null}
    </>
  )
}

export type { Field }
