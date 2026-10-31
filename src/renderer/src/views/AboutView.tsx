/**
 * Novamail - About page. Product identity, version, privacy facts and honesty
 * about limitations live here, because users deserve the truth in one place.
 */
import { useState, type ReactNode } from 'react'
import type { UpdateCheckResult } from '@shared/types'
import { api, errorMessage } from '../bridge'
import { useApp } from '../state/AppProvider'
import { NovamailMark, Icon } from '../components/icons'
import { Banner, Button, Chip, Spinner } from '../components/ui'

export function AboutView(): ReactNode {
  const { state, actions } = useApp()
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const info = state.info

  const checkUpdates = async (): Promise<void> => {
    setChecking(true)
    try {
      setUpdate(await api.app.checkForUpdates())
    } catch (error) {
      actions.pushToast({ tone: 'error', title: 'Update check failed', description: errorMessage(error) })
    } finally {
      setChecking(false)
    }
  }

  return (
    <section className="panel" style={{ flex: 1 }} aria-label="About Novamail">
      <div className="settings-content">
        <div className="settings-section">
          <div className="about-hero">
            <div className="about-mark">
              <NovamailMark size={64} />
            </div>
            <div>
              <h1 style={{ fontSize: 'calc(28px * var(--nm-text-scale))' }}>Novamail</h1>
              <p className="muted" style={{ fontSize: 'var(--nm-base-size)' }}>
                Email, made effortless.
              </p>
              <div className="row" style={{ marginTop: 10 }}>
                <Chip tone="accent">Version {info?.version ?? '1.0.0'}</Chip>
                <Chip>Produced by Baraily Inovex</Chip>
                <Chip>{info?.platform ?? 'win32'} {info?.arch ?? 'x64'}</Chip>
                {info?.isPackaged ? <Chip tone="success">Installed build</Chip> : <Chip tone="warning">Development build</Chip>}
              </div>
            </div>
          </div>

          <div className="settings-group">
            <div className="settings-group__title">What Novamail does well</div>
            <ul className="checklist" style={{ paddingLeft: 0 }}>
              <li>
                <Icon name="check" size={16} /> Multiple IMAP/SMTP accounts in one unified inbox, with OAuth 2.0 sign-in for
                Gmail and Microsoft 365 — no password forms, no MFA workarounds.
              </li>
              <li>
                <Icon name="check" size={16} /> Attachments previewed in place: PDF, pictures, text, CSV, DOCX, XLSX, PPTX,
                audio and video — all rendered locally from an encrypted-on-demand cache.
              </li>
              <li>
                <Icon name="check" size={16} /> Works offline: read synchronised mail, write messages and queue actions; they
                are retried until they reach the server.
              </li>
              <li>
                <Icon name="check" size={16} /> Accessible by design: keyboard navigation, visible focus, adjustable text
                size, light and dark themes with AA contrast.
              </li>
            </ul>
          </div>

          <div className="settings-group">
            <div className="settings-group__title">Privacy and security</div>
            <ul className="checklist" style={{ paddingLeft: 0 }}>
              <li>
                <Icon name="shield" size={16} /> Credentials are encrypted with the Windows DPAPI through Electron
                safeStorage, and never leave the main process.
              </li>
              <li>
                <Icon name="shield" size={16} /> Email HTML is sanitised and rendered in a sandboxed frame without scripting;
                remote images and tracking pixels are blocked until you allow them.
              </li>
              <li>
                <Icon name="shield" size={16} /> Attachments are treated as untrusted: executables are never opened,
                macros never run, and temporary files are pruned automatically.
              </li>
              <li>
                <Icon name="shield" size={16} /> Novamail does not upload your mail anywhere. Office previews are converted on
                this computer.
              </li>
              <li>
                <Icon name="info" size={16} /> Novamail is not end-to-end encrypted. Your provider can read your mail, as with
                any IMAP client.
              </li>
            </ul>
            <p className="small muted">
              Credential storage on this computer:{' '}
              <strong>{info?.credentialStorage === 'os-encrypted' ? 'Windows DPAPI' : 'encrypted fallback store'}</strong>
            </p>
          </div>

          <div className="settings-group">
            <div className="settings-group__title">Updates</div>
            <p className="small muted" style={{ lineHeight: 1.6 }}>
              Novamail never installs updates silently. It can ask a release feed whether a newer version exists, then you
              download it from the official release page where the installer is signed and checksummed.
            </p>
            <div className="row">
              <Button icon="refresh" onClick={() => void checkUpdates()} disabled={checking}>
                {checking ? 'Checking…' : 'Check for updates'}
              </Button>
              <Button variant="ghost" onClick={() => void api.app.openLogsFolder()}>
                Open log folder
              </Button>
            </div>
            {checking ? <Spinner label="Contacting the release feed" /> : null}
            {update ? (
              <>
                <Banner tone={update.updateAvailable ? 'warning' : 'info'} icon={update.verified ? 'shield' : 'info'}>
                  {update.message}
                </Banner>
                {update.updateAvailable && update.downloadUrl ? (
                  <div className="row" style={{ marginTop: 8 }}>
                    <Button
                      variant="primary"
                      icon="download"
                      onClick={() => void api.app.openExternal(update.downloadUrl!)}
                    >
                      Download Novamail {update.latestVersion}
                    </Button>
                  </div>
                ) : null}
                {update.updateAvailable && update.releaseNotes ? (
                  <details className="small muted" style={{ marginTop: 8 }}>
                    <summary>What changed in {update.latestVersion}</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{update.releaseNotes}</pre>
                  </details>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="settings-group">
            <div className="settings-group__title">Build information</div>
            <table className="data-table">
              <tbody>
                <tr>
                  <th scope="row">Product owner</th>
                  <td>Baraily Inovex</td>
                </tr>
                <tr>
                  <th scope="row">Version</th>
                  <td>{info?.version}</td>
                </tr>
                <tr>
                  <th scope="row">Electron / Chromium / Node</th>
                  <td>
                    {info?.electron} / {info?.chrome} / {info?.node}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Data folder</th>
                  <td className="mono">{info?.userDataPath}</td>
                </tr>
                <tr>
                  <th scope="row">Licence</th>
                  <td>{info?.license}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="small muted" style={{ textAlign: 'center' }}>
            © 2026 Baraily Inovex. Novamail is a desktop email client for Windows 10 and Windows 11 (64-bit).
          </p>
        </div>
      </div>
    </section>
  )
}
