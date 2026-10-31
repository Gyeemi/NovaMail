/**
 * Novamail - message composer.
 *
 * A real editor: rich text with a formatting toolbar, recipient chips with
 * contact autocomplete, attachment picker, signatures, autosaved drafts and
 * "send later". Sending goes through the main process, which compiles one MIME
 * message, sends it over SMTP and appends the identical bytes to Sent.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ComposeAttachmentInput, ComposePayload, MailAddress, Signature } from '@shared/types'
import { formatBytes } from '@shared/attachments'
import { api, errorMessage, system } from '../bridge'
import { useApp } from '../state/AppProvider'
import { Icon } from './icons'
import { Button, ConfirmDialog, Field, IconButton, Spinner } from './ui'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function Compose(): ReactNode {
  const { state, actions } = useApp()
  const payload = state.compose
  const [signatures, setSignatures] = useState<Signature[]>([])
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [plainText, setPlainText] = useState(false)
  const [sending, setSending] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleValue, setScheduleValue] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const dirty = useRef(false)

  useEffect(() => {
    if (!payload) return
    void api.signatures
      .list()
      .then(setSignatures)
      .catch(() => setSignatures([]))
    setShowCcBcc(payload.cc.length > 0 || payload.bcc.length > 0)
    setPlainText(!payload.html && Boolean(payload.text))
    setError(null)
    setLastSavedAt(null)
    dirty.current = false
    if (editorRef.current) {
      editorRef.current.innerHTML = payload.html || ''
    }
    // Only reset the editor when a different message is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.draftId, payload?.inReplyTo, payload?.mode, payload?.accountId])

  const current = useCallback((): ComposePayload | null => {
    if (!payload) return null
    const html = plainText ? textToHtml(payload.text) : (editorRef.current?.innerHTML ?? payload.html)
    const text = plainText ? payload.text : htmlToText(html)
    return { ...payload, html, text }
  }, [payload, plainText])

  const saveDraft = useCallback(
    async (silent: boolean) => {
      const body = current()
      if (!body) return
      if (!body.subject && !body.to.length && !body.text.trim()) return
      setSavingDraft(true)
      try {
        const id = await actions.saveDraft(body)
        if (id) setLastSavedAt(new Date().toISOString())
        if (!silent) actions.pushToast({ tone: 'success', title: 'Draft saved' })
      } finally {
        setSavingDraft(false)
      }
    },
    [actions, current]
  )

  useEffect(() => {
    if (!payload) return
    const interval = window.setInterval(
      () => {
        if (dirty.current) void saveDraft(true)
      },
      Math.max(5, (state.settings?.compose.autoSaveDraftSeconds ?? 20)) * 1000
    )
    return () => window.clearInterval(interval)
  }, [payload, saveDraft, state.settings?.compose.autoSaveDraftSeconds])

  const recipientsValid = useMemo(() => {
    if (!payload) return false
    return payload.to.length > 0 && payload.to.every((entry) => EMAIL_PATTERN.test(entry.address))
  }, [payload])

  if (!payload) return null

  const account = state.accounts.find((entry) => entry.id === payload.accountId) ?? state.accounts[0]

  const send = async (): Promise<void> => {
    setError(null)
    if (!recipientsValid) {
      setError('Add at least one valid recipient before sending.')
      return
    }
    if (payload.to.some((entry) => !EMAIL_PATTERN.test(entry.address))) {
      setError('One of the recipient addresses is not valid.')
      return
    }
    const body = current()
    if (!body) return
    setSending(true)
    try {
      const ok = await actions.sendCompose({ ...body, scheduledAt: null })
      if (ok) dirty.current = false
    } finally {
      setSending(false)
    }
  }

  const sendLater = async (): Promise<void> => {
    if (!recipientsValid) {
      setError('Add at least one valid recipient before scheduling.')
      return
    }
    const when = scheduleValue ? new Date(scheduleValue) : null
    if (!when || Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) {
      setError('Choose a time at least a minute from now.')
      return
    }
    const body = current()
    if (!body) return
    setSending(true)
    try {
      const result = await api.compose.schedule({ ...body, scheduledAt: when.toISOString() }, when.toISOString())
      if (result.ok) {
        actions.pushToast({
          tone: 'success',
          title: 'Scheduled',
          description: `This message will be sent on ${when.toLocaleString()}.`
        })
        dirty.current = false
        actions.closeCompose()
      } else {
        setError(result.error ?? 'The message could not be scheduled.')
      }
    } catch (scheduleError) {
      setError(errorMessage(scheduleError))
    } finally {
      setSending(false)
      setScheduleOpen(false)
    }
  }

  const attach = async (): Promise<void> => {
    try {
      const chosen = await api.compose.pickAttachments()
      if (chosen.length > 0) {
        actions.updateCompose({ attachments: [...payload.attachments, ...chosen] })
      }
    } catch (attachError) {
      actions.pushToast({ tone: 'error', title: 'Attachments not added', description: errorMessage(attachError) })
    }
  }

  const onDrop = async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    setDragActive(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    const added: ComposeAttachmentInput[] = []
    for (const file of files) {
      const path = system.getPathForFile(file)
      if (path) {
        added.push({
          path,
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream'
        })
      }
    }
    if (added.length > 0) {
      actions.updateCompose({ attachments: [...payload.attachments, ...added] })
    } else {
      actions.pushToast({
        tone: 'warning',
        title: 'Use the attach button',
        description: 'Dropped files could not be read. Click Attach to choose them instead.'
      })
    }
  }

  const applySignature = (signatureId: string): void => {
    const signature = signatures.find((entry) => entry.id === signatureId)
    if (!signature) {
      actions.updateCompose({ signatureId: null })
      return
    }
    actions.updateCompose({ signatureId: signature.id })
    const editor = editorRef.current
    if (editor) {
      const block = document.createElement('div')
      block.className = 'nm-signature'
      block.innerHTML = signature.html
      editor.appendChild(document.createElement('p'))
      editor.appendChild(block)
      dirty.current = true
    }
  }

  return (
    <div className="overlay overlay--composer" role="presentation">
      <div
        className={`composer ${dragActive ? 'composer--dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Write a message"
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => void onDrop(event)}
      >
        <header className="composer__header">
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            <Icon name="compose" size={18} />
            <strong className="truncate">{payload.subject || 'New message'}</strong>
            {payload.draftId ? <span className="chip chip--muted">Draft</span> : null}
          </div>
          <span className="spacer" />
          <span className="small muted">
            {savingDraft ? 'Saving…' : lastSavedAt ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}` : ''}
          </span>
          <IconButton
            icon="close"
            label="Close the composer"
            onClick={() => {
              if (payload.subject || payload.to.length || (editorRef.current?.textContent ?? '').trim()) {
                setConfirmDiscard(true)
              } else actions.closeCompose()
            }}
          />
        </header>

        <div className="composer__fields">
          <div className="composer__field">
            <span className="composer__label">From</span>
            <select
              className="select select--compact"
              value={payload.accountId}
              onChange={(event) => actions.updateCompose({ accountId: event.target.value })}
              aria-label="Send from"
            >
              {state.accounts.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.displayName} &lt;{entry.email}&gt;
                </option>
              ))}
            </select>
          </div>

          <RecipientField
            label="To"
            value={payload.to}
            onChange={(to) => {
              dirty.current = true
              actions.updateCompose({ to })
            }}
            error={payload.to.some((entry) => !EMAIL_PATTERN.test(entry.address)) ? 'That address does not look valid.' : undefined}
            trailing={
              <button type="button" className="link-button" onClick={() => setShowCcBcc((value) => !value)}>
                {showCcBcc ? 'Hide Cc/Bcc' : 'Cc/Bcc'}
              </button>
            }
          />

          {showCcBcc ? (
            <>
              <RecipientField
                label="Cc"
                value={payload.cc}
                onChange={(cc) => {
                  dirty.current = true
                  actions.updateCompose({ cc })
                }}
              />
              <RecipientField
                label="Bcc"
                value={payload.bcc}
                onChange={(bcc) => {
                  dirty.current = true
                  actions.updateCompose({ bcc })
                }}
              />
            </>
          ) : null}

          <div className="composer__field">
            <span className="composer__label">Subject</span>
            <input
              className="composer__subject"
              value={payload.subject}
              placeholder="Subject"
              aria-label="Subject"
              onChange={(event) => {
                dirty.current = true
                actions.updateCompose({ subject: event.target.value })
              }}
            />
          </div>
        </div>

        <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
          {plainText ? (
            <span className="small muted">Plain text mode — formatting is not available.</span>
          ) : (
            <>
              {(
                [
                  { command: 'bold', icon: 'text', label: 'Bold' },
                  { command: 'italic', icon: 'text', label: 'Italic' },
                  { command: 'underline', icon: 'text', label: 'Underline' },
                  { command: 'insertUnorderedList', icon: 'tasks', label: 'Bulleted list' },
                  { command: 'insertOrderedList', icon: 'tasks', label: 'Numbered list' },
                  { command: 'formatBlock', value: 'blockquote', icon: 'reply', label: 'Quote' },
                  { command: 'removeFormat', icon: 'close', label: 'Clear formatting' }
                ] as const
              ).map((button, index) => (
                <button
                  key={`${button.command}-${index}`}
                  type="button"
                  className="toolbar-button"
                  title={button.label}
                  aria-label={button.label}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    'value' in button
                      ? document.execCommand(button.command, false, button.value)
                      : document.execCommand(button.command, false)
                    dirty.current = true
                  }}
                  style={{ fontWeight: button.command === 'bold' ? 700 : undefined, fontStyle: button.command === 'italic' ? 'italic' : undefined }}
                >
                  {button.label.slice(0, 2)}
                </button>
              ))}
              <button
                type="button"
                className="toolbar-button"
                title="Insert a link"
                aria-label="Insert a link"
                onMouseDown={(event) => {
                  event.preventDefault()
                  const url = window.prompt('Link address (https://…)')
                  if (url && /^https?:\/\//i.test(url)) document.execCommand('createLink', false, url)
                }}
              >
                Link
              </button>
              <span className="divider-vertical" />
            </>
          )}
          <button type="button" className="toolbar-button" onClick={() => setPlainText((value) => !value)}>
            {plainText ? 'Rich text' : 'Plain text'}
          </button>
          <span className="spacer" />
          <button type="button" className="toolbar-button" onClick={() => void attach()}>
            <Icon name="attachment" size={14} /> Attach
          </button>
          {signatures.length > 0 ? (
            <select
              className="select select--compact"
              aria-label="Signature"
              value={payload.signatureId ?? ''}
              onChange={(event) => applySignature(event.target.value)}
            >
              <option value="">No signature</option>
              {signatures.map((signature) => (
                <option key={signature.id} value={signature.id}>
                  {signature.name}
                </option>
              ))}
            </select>
          ) : null}
          <label className="checkbox-row" style={{ gap: 5 }}>
            <input
              type="checkbox"
              checked={payload.requestReadReceipt}
              onChange={(event) => actions.updateCompose({ requestReadReceipt: event.target.checked })}
            />
            <span className="small">Receipt</span>
          </label>
          <select
            className="select select--compact"
            aria-label="Importance"
            value={payload.importance}
            onChange={(event) => actions.updateCompose({ importance: event.target.value as ComposePayload['importance'] })}
          >
            <option value="low">Low importance</option>
            <option value="normal">Normal</option>
            <option value="high">High importance</option>
          </select>
        </div>

        <div className="composer__editor-area">
          {plainText ? (
            <textarea
              className="editor editor--plain"
              value={payload.text}
              placeholder="Write your message"
              aria-label="Message body"
              onChange={(event) => {
                dirty.current = true
                actions.updateCompose({ text: event.target.value })
              }}
            />
          ) : (
            <div
              ref={editorRef}
              className="editor"
              contentEditable
              role="textbox"
              aria-multiline="true"
              aria-label="Message body"
              spellCheck
              suppressContentEditableWarning
              onInput={() => {
                dirty.current = true
                if (editorRef.current) actions.updateCompose({ html: editorRef.current.innerHTML })
              }}
              onBlur={() => {
                if (editorRef.current) actions.updateCompose({ html: editorRef.current.innerHTML })
              }}
            />
          )}

          {payload.attachments.length > 0 ? (
            <div className="composer__attachments">
              {payload.attachments.map((attachment, index) => (
                <div key={`${attachment.path}-${index}`} className="attachment-card">
                  <span className="attachment-card__icon">
                    <Icon name="attachment" size={18} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="attachment-card__name truncate">{attachment.name}</span>
                    <span className="attachment-card__meta small muted">{formatBytes(attachment.size)}</span>
                  </span>
                  <IconButton
                    icon="close"
                    label={`Remove ${attachment.name}`}
                    size={14}
                    onClick={() =>
                      actions.updateCompose({
                        attachments: payload.attachments.filter((_, position) => position !== index)
                      })
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="banner banner--danger" role="alert" style={{ margin: '0 16px 8px' }}>
            <Icon name="error" size={16} />
            <div>{error}</div>
          </div>
        ) : null}

        <footer className="composer__footer">
          <Button variant="primary" icon="send" onClick={() => void send()} disabled={sending || !recipientsValid}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
          <div style={{ position: 'relative' }}>
            <Button icon="clock" onClick={() => setScheduleOpen((value) => !value)} disabled={sending}>
              Send later
            </Button>
            {scheduleOpen ? (
              <div className="popover" style={{ bottom: 'calc(100% + 8px)', left: 0, width: 260 }}>
                <div className="popover__header">Send this message later</div>
                <div className="stack" style={{ padding: 10, gap: 8 }}>
                  <input
                    type="datetime-local"
                    className="input"
                    value={scheduleValue}
                    aria-label="Send at"
                    onChange={(event) => setScheduleValue(event.target.value)}
                  />
                  <Button variant="primary" size="sm" onClick={() => void sendLater()}>
                    Schedule
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
          <Button icon="save" onClick={() => void saveDraft(false)} disabled={savingDraft}>
            Save draft
          </Button>
          <span className="spacer" />
          <span className="modal__footer-note">
            {account ? `Sending as ${account.email}` : ''}
            {payload.attachments.length > 0 ? ` • ${payload.attachments.length} attachment(s)` : ''}
          </span>
          <Button
            variant="danger"
            onClick={() => {
              dirty.current = false
              if (payload.draftId) void api.compose.discardDraft(payload.draftId).catch(() => undefined)
              actions.closeCompose()
            }}
          >
            Discard
          </Button>
        </footer>
      </div>

      {confirmDiscard ? (
        <ConfirmDialog
          title="Close without sending?"
          message="The message stays in Drafts so you can finish it later."
          confirmLabel="Close and keep the draft"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={async () => {
            setConfirmDiscard(false)
            await saveDraft(true)
            actions.closeCompose()
          }}
        />
      ) : null}

      {sending ? (
        <div className="composer__sending" aria-live="polite">
          <Spinner label="Sending your message" />
        </div>
      ) : null}
    </div>
  )
}

function RecipientField({
  label,
  value,
  onChange,
  error,
  trailing
}: {
  label: string
  value: MailAddress[]
  onChange: (value: MailAddress[]) => void
  error?: string
  trailing?: ReactNode
}): ReactNode {
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState<{ email: string; name: string }[]>([])
  const [highlighted, setHighlighted] = useState(0)

  useEffect(() => {
    if (text.trim().length < 2) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void api.contacts
        .suggest(text)
        .then((results) => {
          if (!cancelled) {
            setSuggestions(results.slice(0, 6).map((entry) => ({ email: entry.email, name: entry.name })))
            setHighlighted(0)
          }
        })
        .catch(() => setSuggestions([]))
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [text])

  const add = (raw: string): void => {
    const address = raw.trim().replace(/[,;]+$/, '')
    if (!address) return
    const match = /^(.*)<([^>]+)>$/.exec(address)
    const parsed: MailAddress = match
      ? { name: (match[1] ?? '').trim().replace(/^"|"$/g, ''), address: (match[2] ?? '').trim() }
      : { name: '', address }
    if (value.some((entry) => entry.address.toLowerCase() === parsed.address.toLowerCase())) {
      setText('')
      return
    }
    onChange([...value, parsed])
    setText('')
    setSuggestions([])
  }

  return (
    <div className="composer__field">
      <span className="composer__label">{label}</span>
      <div className="recipient-input">
        {value.map((entry, index) => (
          <span key={`${entry.address}-${index}`} className="recipient-chip" title={entry.address}>
            <span className="truncate">{entry.name || entry.address}</span>
            <button
              type="button"
              aria-label={`Remove ${entry.address}`}
              onClick={() => onChange(value.filter((_, position) => position !== index))}
            >
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
        <div style={{ position: 'relative', flex: 1, minWidth: 140 }}>
          <input
            value={text}
            placeholder={value.length === 0 ? 'name@example.com' : ''}
            aria-label={`${label} recipients`}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
                event.preventDefault()
                add(suggestions[highlighted] ? suggestions[highlighted]!.email : text)
              } else if (event.key === 'Backspace' && !text && value.length > 0) {
                onChange(value.slice(0, -1))
              } else if (event.key === 'ArrowDown' && suggestions.length > 0) {
                event.preventDefault()
                setHighlighted((current) => Math.min(current + 1, suggestions.length - 1))
              } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
                event.preventDefault()
                setHighlighted((current) => Math.max(current - 1, 0))
              }
            }}
            onBlur={() => {
              if (text.trim()) add(text)
            }}
          />
          {suggestions.length > 0 ? (
            <div className="suggestions" style={{ top: 'calc(100% + 4px)' }} role="listbox" aria-label="Contact suggestions">
              {suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.email}
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  className="suggestion"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    add(suggestion.email)
                  }}
                >
                  <Icon name="contacts" size={14} />
                  <span className="suggestion__value">{suggestion.name || suggestion.email}</span>
                  <span className="suggestion__desc">{suggestion.email}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {trailing}
      {error ? <span className="field__error">{error}</span> : null}
    </div>
  )
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export function textToHtml(text: string): string {
  return `<div style="white-space:pre-wrap">${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />')}</div>`
}

export type { Field }
