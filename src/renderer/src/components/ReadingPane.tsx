/**
 * Novamail - reading pane.
 *
 * Message HTML is hostile input: it is rendered inside an iframe with no script
 * permission and no same-origin access, so no message can touch the app. Remote
 * images stay blocked until the reader explicitly allows them for that message.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AttachmentMeta, MessageDetail, MessageSummary } from '@shared/types'
import { classifyAttachment, evaluateSafety, formatBytes, safetyLabel } from '@shared/attachments'
import { api, errorMessage } from '../bridge'
import { useApp } from '../state/AppProvider'
import { Icon, type IconName } from './icons'
import { Button, Chip, EmptyState, IconButton, Spinner, formatDate, initials } from './ui'

export function ReadingPane(): ReactNode {
  const { state, actions } = useApp()
  const [remoteHtml, setRemoteHtml] = useState<string | null>(null)
  const [loadImagesBusy, setLoadImagesBusy] = useState(false)
  const detail = state.detail
  const settings = state.settings

  useEffect(() => {
    setRemoteHtml(null)
  }, [detail?.id])

  const html = remoteHtml ?? detail?.html ?? null
  const blocked = remoteHtml ? 0 : (detail?.blockedRemoteContentCount ?? 0)

  const srcdoc = useMemo(() => {
    if (!detail) return ''
    return documentShell(
      html ?? (detail.text ? textToHtml(detail.text) : '<p class="nm-empty">This message has no readable body.</p>'),
      {
        dark: document.documentElement.dataset.theme === 'dark',
        textScale: settings?.ui.textScale ?? 1,
        accent: settings?.ui.accent ?? '#3f7d8c'
      }
    )
  }, [detail, html, settings?.ui.textScale, settings?.ui.accent])

  if (state.detailLoading && !detail) {
    return (
      <section className="panel reading-pane" aria-busy="true">
        <Spinner large label="Opening the message" />
      </section>
    )
  }

  if (!detail) {
    return (
      <section className="panel reading-pane" aria-label="Reading pane">
        <EmptyState
          icon="mail"
          title="No message selected"
          description="Choose a message from the list to read it here. Press J or K to move through your mail."
        />
      </section>
    )
  }

  const fromLabel = detail.from.name ? `${detail.from.name} <${detail.from.address}>` : detail.from.address
  const dangerous = detail.attachments.filter((attachment) => evaluateSafety(attachment.filename, attachment.mimeType).level === 'dangerous')

  return (
    <section className={`panel reading-pane reading-pane--${settings?.ui.readingPane ?? 'right'}`} aria-label="Message">
      <header className="reader-header">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <h2 className="reader-subject">{detail.subject || '(no subject)'}</h2>
          {detail.isStarred ? <Chip tone="accent">Starred</Chip> : null}
          {detail.isEncrypted ? <Chip tone="success">Encrypted</Chip> : null}
        </div>

        <div className="reader-toolbar">
          <IconButton icon="reply" label="Reply" onClick={() => void actions.openCompose('reply')} />
          <IconButton icon="replyAll" label="Reply to all" onClick={() => void actions.openCompose('replyAll')} />
          <IconButton icon="forward" label="Forward" onClick={() => void actions.openCompose('forward')} />
          <span className="divider-vertical" />
          <IconButton
            icon={detail.isStarred ? 'starFilled' : 'star'}
            label={detail.isStarred ? 'Remove the star' : 'Star this message'}
            pressed={detail.isStarred}
            onClick={() => void actions.flag('isStarred', !detail.isStarred, [detail.id])}
          />
          <IconButton
            icon="important"
            label={detail.isImportant ? 'Not important' : 'Mark as important'}
            pressed={detail.isImportant}
            onClick={() => void actions.flag('isImportant', !detail.isImportant, [detail.id])}
          />
          <IconButton icon="archive" label="Archive" onClick={() => void actions.archive([detail.id])} />
          <IconButton icon="snooze" label="Snooze" onClick={() => void actions.snooze([detail.id], tomorrowMorning())} />
          <IconButton icon="trash" label="Delete" onClick={() => void actions.trash([detail.id])} />
        </div>

        <div className="reader-sender">
          <div className="list-item__avatar" style={{ width: 38, height: 38 }}>
            {initials(detail.from.name, detail.from.address)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="reader-sender__from truncate">{fromLabel}</div>
            <div className="small muted truncate">
              To: {detail.to.map((entry) => entry.name || entry.address).join(', ') || 'you'}
              {detail.cc.length > 0 ? ` • Cc: ${detail.cc.map((entry) => entry.name || entry.address).join(', ')}` : ''}
            </div>
          </div>
          <div className="small muted" style={{ textAlign: 'right' }}>
            <div>{formatDate(detail.date, 'full')}</div>
            {detail.attachments.length > 0 ? (
              <div className="small">
                {detail.attachments.length} attachment{detail.attachments.length === 1 ? '' : 's'}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {blocked > 0 ? (
        <div className="banner banner--warning" style={{ margin: '0 16px 8px' }}>
          <Icon name="eyeOff" size={16} />
          <div style={{ flex: 1 }}>
            <strong>Remote images are blocked.</strong> This keeps senders from tracking when you opened the message.
          </div>
          <Button
            size="sm"
            onClick={async () => {
              setLoadImagesBusy(true)
              try {
                const result = await api.messages.showRemoteImages(detail.id)
                if (result.html) setRemoteHtml(result.html)
                if (result.failed > 0) {
                  actions.pushToast({
                    tone: 'info',
                    title: `${result.failed} image(s) could not be loaded`,
                    description: 'They may be hosted on a blocked or unreachable server.'
                  })
                }
              } catch (error) {
                actions.pushToast({ tone: 'error', title: 'Images could not be loaded', description: errorMessage(error) })
              } finally {
                setLoadImagesBusy(false)
              }
            }}
            disabled={loadImagesBusy}
          >
            {loadImagesBusy ? 'Loading…' : 'Show images'}
          </Button>
        </div>
      ) : null}

      {dangerous.length > 0 ? (
        <div className="banner banner--danger" style={{ margin: '0 16px 8px' }}>
          <Icon name="warning" size={16} />
          <div>
            <strong>This message contains an attachment that can run code.</strong> {dangerous.map((entry) => entry.filename).join(', ')}{' '}
            was not opened. Only open it if you trust the sender and expected the file.
          </div>
        </div>
      ) : null}

      <div className="reader-body">
        {html ? (
          <iframe
            className="reader-frame"
            title={`Message from ${detail.from.name || detail.from.address}`}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={srcdoc}
          />
        ) : (
          <div className="text-preview">{detail.text}</div>
        )}
      </div>

      {detail.attachments.length > 0 ? (
        <div className="attachment-strip" aria-label="Attachments">
          {detail.attachments.map((attachment) => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              onOpen={() => actions.openAttachment(detail.id, attachment.id, detail.attachments)}
              onSave={async () => {
                try {
                  const result = await api.attachments.saveAs(attachment.id)
                  if (result.ok && result.savedPath) {
                    actions.pushToast({ tone: 'success', title: 'Saved', description: result.savedPath })
                  } else if (result.error) {
                    actions.pushToast({ tone: 'error', title: 'Not saved', description: result.error })
                  }
                } catch (error) {
                  actions.pushToast({ tone: 'error', title: 'Not saved', description: errorMessage(error) })
                }
              }}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function AttachmentCard({
  attachment,
  onOpen,
  onSave
}: {
  attachment: AttachmentMeta
  onOpen: () => void
  onSave: () => void
}): ReactNode {
  const safety = evaluateSafety(attachment.filename, attachment.mimeType)
  const kind = classifyAttachment(attachment.filename, attachment.mimeType)
  const icon: IconName =
    kind === 'pdf'
      ? 'pdf'
      : kind === 'image'
        ? 'image'
        : kind === 'audio'
          ? 'audio'
          : kind === 'video'
            ? 'video'
            : kind === 'spreadsheet' || kind === 'csv'
              ? 'spreadsheet'
              : kind === 'presentation'
                ? 'slides'
                : kind === 'document'
                  ? 'document'
                  : kind === 'text'
                    ? 'text'
                    : kind === 'archive'
                      ? 'archive'
                      : kind === 'email'
                        ? 'mail'
                        : 'file'
  return (
    <div className={`attachment-card attachment-card--${safety.level}`}>
      <button type="button" className="attachment-card__main" onClick={onOpen} title={`Preview ${attachment.filename}`}>
        <span className="attachment-card__icon">
          <Icon name={icon} size={20} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span className="attachment-card__name truncate">{attachment.filename}</span>
          <span className="attachment-card__meta small muted">
            {formatBytes(attachment.size)}
            {safety.level !== 'safe' ? ` • ${safetyLabel(safety.level)}` : ''}
          </span>
        </span>
      </button>
      <IconButton icon="download" label={`Save ${attachment.filename}`} size={15} onClick={onSave} />
    </div>
  )
}

function tomorrowMorning(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(8, 0, 0, 0)
  return date.toISOString()
}

function textToHtml(text: string): string {
  return `<div style="white-space:pre-wrap">${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</div>`
}

/**
 * The iframe document. Scripts cannot run (the frame is sandboxed without
 * allow-scripts) and the inner CSP blocks any network request the sanitizer
 * might have missed.
 */
function documentShell(body: string, options: { dark: boolean; textScale: number; accent: string }): string {
  const background = options.dark ? '#12181b' : '#ffffff'
  const colour = options.dark ? '#e7edef' : '#172026'
  const muted = options.dark ? '#9fb0b6' : '#5c6b73'
  const size = Math.round(15.5 * options.textScale)
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src novamail-att: data:; style-src 'unsafe-inline'; media-src novamail-att: data:; form-action 'none'; base-uri 'none'">
<style>
  :root { color-scheme: ${options.dark ? 'dark' : 'light'}; }
  html, body { margin: 0; padding: 0; background: ${background}; }
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; font-size: ${size}px; line-height: 1.55; color: ${colour}; padding: 16px 18px 24px; word-wrap: break-word; }
  a { color: ${options.accent}; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; border-collapse: collapse; }
  td, th { padding: 2px 6px; }
  blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid ${muted}55; color: ${muted}; }
  pre { white-space: pre-wrap; font-family: Consolas, "Cascadia Mono", monospace; font-size: 0.92em; }
  .nm-empty { color: ${muted}; font-style: italic; }
  * { max-width: 100%; }
</style></head><body>${body}</body></html>`
}

export type { MessageDetail, MessageSummary }
