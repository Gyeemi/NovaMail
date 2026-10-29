/**
 * Novamail - reusable UI primitives.
 *
 * Accessibility rules baked in:
 *  - icon-only buttons require an accessible label and show a tooltip
 *  - dialogs trap focus, close on Escape and restore focus
 *  - toasts are announced through an aria-live region
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode
} from 'react'
import { Icon, type IconName } from './icons'

/* ------------------------------------------------------------------ button */

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  icon?: IconName
  children?: ReactNode
}

export function Button({ variant = 'default', size = 'md', icon, children, className = '', ...rest }: ButtonProps) {
  const classes = ['btn', variant === 'primary' ? 'btn--primary' : '', variant === 'ghost' ? 'btn--ghost' : '', variant === 'danger' ? 'btn--danger' : '', size === 'sm' ? 'btn--sm' : '', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className={classes} {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  label: string
  /** show the tooltip on hover/focus (default true) */
  tooltip?: boolean
  size?: number
  pressed?: boolean
}

export function IconButton({ icon, label, tooltip = true, size = 18, pressed, className = '', ...rest }: IconButtonProps) {
  const button = (
    <button
      type="button"
      className={`icon-btn ${className}`}
      aria-label={label}
      title={tooltip ? label : undefined}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  )
  if (!tooltip) return button
  return (
    <span className="tip">
      {button}
      <span className="tip__bubble" role="tooltip">
        {label}
      </span>
    </span>
  )
}

/* ------------------------------------------------------------------ fields */

export interface FieldProps {
  label: string
  htmlFor?: string
  hint?: string
  error?: string | null
  children: ReactNode
  id?: string
}

export function Field({ label, htmlFor, hint, error, children, id }: FieldProps) {
  const generated = useId()
  const fieldId = htmlFor ?? id ?? generated
  return (
    <div className="field">
      <label className="field__label" htmlFor={fieldId}>
        {label}
      </label>
      {children}
      {hint && !error ? <span className="field__hint">{hint}</span> : null}
      {error ? (
        <span className="field__error" role="alert">
          <Icon name="warning" size={15} /> {error}
        </span>
      ) : null}
    </div>
  )
}

export interface ToggleProps {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  return (
    <label className="checkbox-row" style={{ alignItems: 'center' }}>
      <span
        className="switch"
        role="switch"
        aria-checked={checked}
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault()
            onChange(!checked)
          }
        }}
        onClick={() => {
          if (!disabled) onChange(!checked)
        }}
        style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
      >
        <span className="switch__track">
          <span className="switch__thumb" />
        </span>
      </span>
      <span className="checkbox-row__text">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </span>
    </label>
  )
}

export interface SegmentedProps<T extends string> {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  /** Accessible name for the group. Optional when the control sits inside a labelled row. */
  label?: string
}

export function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__option"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ modals */

export interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  labelledBy?: string
  headerExtra?: ReactNode
}

export function Modal({ title, onClose, children, footer, size = 'md', headerExtra }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusable = dialog?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable?.[0]
    first?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const items = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((element) => element.offsetParent !== null)
      if (items.length === 0) return
      const firstItem = items[0]!
      const lastItem = items[items.length - 1]!
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal__header">
          <h2 className="modal__title" id={titleId}>
            {title}
          </h2>
          {headerExtra}
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export interface ConfirmDialogProps {
  title: string
  message: string
  detail?: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <span className="modal__footer-note">{detail}</span>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 'var(--nm-base-size)', lineHeight: 1.6 }}>{message}</p>
    </Modal>
  )
}

/* --------------------------------------------------------------- feedback */

export function EmptyState({
  icon = 'mail',
  title,
  description,
  action
}: {
  icon?: IconName
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <Icon name={icon} size={34} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function Spinner({ large = false, label = 'Loading' }: { large?: boolean; label?: string }) {
  return (
    <span className="row" role="status" aria-live="polite" style={{ justifyContent: 'center', padding: 16 }}>
      <span className={`spinner ${large ? 'spinner--lg' : ''}`} />
      <span className="small muted">{label}</span>
    </span>
  )
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      {label ? <span className="tiny muted">{label}</span> : null}
      <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress__bar" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  )
}

export function Chip({
  children,
  tone = 'default',
  icon
}: {
  children: ReactNode
  tone?: 'default' | 'accent' | 'warning' | 'danger' | 'success'
  icon?: IconName
}) {
  return (
    <span className={`chip ${tone !== 'default' ? `chip--${tone}` : ''}`}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  )
}

export function Banner({
  tone = 'info',
  icon,
  children,
  actions
}: {
  tone?: 'info' | 'warning' | 'danger'
  icon?: IconName
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className={`banner ${tone !== 'info' ? `banner--${tone}` : ''}`}>
      {icon ? <Icon name={icon} size={18} /> : null}
      <div style={{ flex: 1, minWidth: 180, lineHeight: 1.55 }}>{children}</div>
      {actions}
    </div>
  )
}

/* ------------------------------------------------------------- formatting */

export function formatDate(value: string, style: 'list' | 'full' = 'list'): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (style === 'full') {
    return date.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

export function formatRelative(value: string | null): string {
  if (!value) return 'never'
  const diff = Date.now() - Date.parse(value)
  if (Number.isNaN(diff)) return 'unknown'
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function initials(name: string, address?: string): string {
  const source = (name || address || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase()
}

export function useCopyToClipboard(): (text: string) => Promise<boolean> {
  return useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }, [])
}
