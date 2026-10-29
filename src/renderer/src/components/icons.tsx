/**
 * Novamail - icon set.
 *
 * Simple stroke icons drawn on a 24x24 grid. Icons are decorative: every icon
 * button in the app also carries an accessible label (aria-label or a tooltip).
 */
import type { JSX } from 'react'

export type IconName =
  | 'mail'
  | 'inbox'
  | 'star'
  | 'starFilled'
  | 'important'
  | 'draft'
  | 'send'
  | 'snooze'
  | 'archive'
  | 'spam'
  | 'trash'
  | 'folder'
  | 'label'
  | 'contacts'
  | 'calendar'
  | 'tasks'
  | 'settings'
  | 'search'
  | 'compose'
  | 'reply'
  | 'replyAll'
  | 'forward'
  | 'attachment'
  | 'download'
  | 'print'
  | 'external'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'close'
  | 'check'
  | 'plus'
  | 'minus'
  | 'refresh'
  | 'offline'
  | 'warning'
  | 'info'
  | 'error'
  | 'more'
  | 'eye'
  | 'eyeOff'
  | 'zoomIn'
  | 'zoomOut'
  | 'rotate'
  | 'fit'
  | 'shield'
  | 'user'
  | 'bell'
  | 'menu'
  | 'drag'
  | 'play'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'spreadsheet'
  | 'slides'
  | 'text'
  | 'file'
  | 'help'
  | 'keyboard'
  | 'logout'
  | 'filter'
  | 'command'
  | 'sun'
  | 'moon'
  | 'clock'
  | 'save'
  | 'upload'

const PATHS: Record<IconName, JSX.Element> = {
  mail: <><rect x="2.5" y="4.5" width="19" height="15" rx="3" /><path d="m3 7 8.2 5.6a1.4 1.4 0 0 0 1.6 0L21 7" /></>,
  inbox: <><path d="M3 12.5 5.6 5A2 2 0 0 1 7.5 3.5h9a2 2 0 0 1 1.9 1.5L21 12.5" /><path d="M3 12.5h5l1.5 2.5h5L16 12.5h5v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  star: <path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z" />,
  starFilled: <path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z" fill="currentColor" />,
  important: <><path d="M12 3.5 21 20H3z" /><path d="M12 9.5v4" /><path d="M12 16.5h.01" /></>,
  draft: <><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M14 3.5v5h5" /><path d="M8.5 13h7M8.5 16.5h4" /></>,
  send: <><path d="M21 3.5 10.5 14" /><path d="M21 3.5 14.5 21l-4-7-7-4z" /></>,
  snooze: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4.5l3 1.8" /><path d="M9 2.5h6" /></>,
  archive: <><rect x="3" y="4.5" width="18" height="5" rx="1.6" /><path d="M4.5 9.5v8a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-8" /><path d="M10 13.5h4" /></>,
  spam: <><path d="M12 3.5 3.5 8v8l8.5 4.5L20.5 16V8z" /><path d="M12 8.5v4.5" /><path d="M12 16h.01" /></>,
  trash: <><path d="M4 6.5h16" /><path d="M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8v1.7" /><path d="M6 6.5 7 20a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13.5" /><path d="M10 10.5v6M14 10.5v6" /></>,
  folder: <path d="M3.5 7a2 2 0 0 1 2-2h3.7a2 2 0 0 1 1.5.7l1.1 1.3h6.7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  label: <><path d="M4 5.5h9.8L21 12l-7.2 6.5H4z" /><circle cx="8" cy="12" r="1.4" /></>,
  contacts: <><circle cx="9.5" cy="8.5" r="3.5" /><path d="M3.5 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5" /><path d="M16.5 7h4M16.5 11h4M16.5 15h2.5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  tasks: <><path d="m3.5 7 2 2 3.5-3.5" /><path d="m3.5 15 2 2L9 13.5" /><path d="M12.5 7.5h8M12.5 16h8" /></>,
  settings: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  compose: <><path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" /><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></>,
  reply: <><path d="M9 7 3.5 12 9 17" /><path d="M3.5 12h9a7 7 0 0 1 7 7v1" /></>,
  replyAll: <><path d="M7 7 2 12l5 5" /><path d="M13 7 8 12l5 5" /><path d="M8 12h5.5a6.5 6.5 0 0 1 6.5 6.5V20" /></>,
  forward: <><path d="m15 7 5.5 5L15 17" /><path d="M20.5 12h-9a7 7 0 0 0-7 7v1" /></>,
  attachment: <path d="M20 11.5 12 19.4a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3" />,
  download: <><path d="M12 3.5v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M4 18.5v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" /></>,
  print: <><path d="M7 8.5V3.5h10v5" /><rect x="3.5" y="8.5" width="17" height="8" rx="2" /><path d="M7 14.5h10v6H7z" /></>,
  external: <><path d="M14 3.5h6.5V10" /><path d="m20.5 3.5-9 9" /><path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
  chevronLeft: <path d="m14.5 5-7 7 7 7" />,
  chevronRight: <path d="m9.5 5 7 7-7 7" />,
  chevronDown: <path d="m5 9.5 7 7 7-7" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  refresh: <><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 4v5h-5" /></>,
  offline: <><path d="M3 3l18 18" /><path d="M8.5 8.6A9 9 0 0 1 12 8c3.4 0 6.4 1.9 7.9 4.7" /><path d="M6.2 12.4A9 9 0 0 1 8 11" /><path d="M4.1 17h15.8" /></>,
  warning: <><path d="M12 3.8 21 20H3z" /><path d="M12 9.5v5" /><path d="M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><path d="M12 8h.01" /></>,
  error: <><circle cx="12" cy="12" r="8.5" /><path d="m9 9 6 6M15 9l-6 6" /></>,
  more: <><circle cx="12" cy="5.5" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="18.5" r="1.4" fill="currentColor" /></>,
  eye: <><path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 6.7A9.6 9.6 0 0 1 12 6.5c6 0 9.5 5.5 9.5 5.5a17 17 0 0 1-3 3.6" /><path d="M6.4 8.2A17 17 0 0 0 2.5 12S6 17.5 12 17.5a9.7 9.7 0 0 0 3.9-.8" /></>,
  zoomIn: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M8 10.5h5M10.5 8v5" /></>,
  zoomOut: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M8 10.5h5" /></>,
  rotate: <><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 4v5h-5" /><path d="M12 8.5v7M9 12h6" /></>,
  fit: <><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" /><path d="M20 9V5.5A1.5 1.5 0 0 0 18.5 4H15" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20H9" /><path d="M20 15v3.5A1.5 1.5 0 0 1 18.5 20H15" /></>,
  shield: <><path d="M12 3.5 5 6v6c0 4.2 3 7.4 7 8.5 4-1.1 7-4.3 7-8.5V6z" /><path d="m9 12 2 2 4-4" /></>,
  user: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20.5c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6" /></>,
  bell: <><path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  drag: <><circle cx="9" cy="6" r="1.3" fill="currentColor" /><circle cx="15" cy="6" r="1.3" fill="currentColor" /><circle cx="9" cy="12" r="1.3" fill="currentColor" /><circle cx="15" cy="12" r="1.3" fill="currentColor" /><circle cx="9" cy="18" r="1.3" fill="currentColor" /><circle cx="15" cy="18" r="1.3" fill="currentColor" /></>,
  play: <path d="M8 5.5v13l11-6.5z" />,
  pdf: <><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M14 3.5v5h5" /><path d="M8.5 16.5c2.5-1 4-3.5 4.5-5.5.3-1.2-.2-2-1-1.7-.9.3-.8 1.9.5 4 1 1.6 2.4 2.6 3.5 2.7" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m4.5 17 4.7-4.6a1.6 1.6 0 0 1 2.2 0L19.5 20" /></>,
  audio: <><path d="M4 11v2a1 1 0 0 0 1 1h2l4 4V6L7 10H5a1 1 0 0 0-1 1z" /><path d="M15.5 9a4.5 4.5 0 0 1 0 6" /><path d="M18.5 6.5a8 8 0 0 1 0 11" /></>,
  video: <><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="m15.5 11 6-3.5v9L15.5 13z" /></>,
  document: <><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M14 3.5v5h5" /><path d="M8.5 12.5h7M8.5 16h5" /></>,
  spreadsheet: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15" /></>,
  slides: <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M12 16.5v4M8.5 20.5h7" /><path d="M8 8h8" /></>,
  text: <><path d="M5.5 5.5h13M5.5 10h13M5.5 14.5h9M5.5 19h6" /></>,
  file: <><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M14 3.5v5h5" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.4 2.4 0 1 1 3.3 2.2c-.6.3-.9.8-.9 1.5v.3" /><path d="M12 16.6h.01" /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 12.8h.01M9.5 12.8h.01M13 12.8h.01M16.5 12.8h.01M8 16h8" /></>,
  logout: <><path d="M9 20H5.5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2H9" /><path d="m15 8 4 4-4 4M19 12H9" /></>,
  filter: <path d="M3.5 5.5h17l-6.5 8v6l-4 2v-8z" />,
  command: <path d="M9 6.5a2.5 2.5 0 1 0-2.5 2.5H9m0-2.5V9m0-2.5A2.5 2.5 0 1 1 11.5 4V9m0 0h2.5m0 0V6.5A2.5 2.5 0 1 1 17.5 9H14m-2.5 0v6m0 0H9m2.5 0h2.5m0 0v2.5a2.5 2.5 0 1 0 2.5-2.5H14m-5 0H6.5A2.5 2.5 0 1 0 9 17.5z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  save: <><path d="M18.5 20.5h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h9l6 6v9a2 2 0 0 1-2 2z" /><path d="M7.5 3.5v6h8v-6M16 20.5v-6H8v6" /></>,
  upload: <><path d="M12 20.5V9.5" /><path d="m7.5 13.5 4.5-4.5 4.5 4.5" /><path d="M4 6V4.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2V6" /></>
}

const FILLED_SET = new Set<IconName>(['starFilled', 'play', 'more', 'drag'])

export interface IconProps {
  name: IconName
  size?: number
  className?: string
  title?: string
}

export function Icon({ name, size = 20, className, title }: IconProps): JSX.Element {
  const filled = FILLED_SET.has(name)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  )
}

/** The Novamail mark: an envelope folded into an "N" gesture. */
export function NovamailMark({ size = 32, withBackground = false }: { size?: number; withBackground?: boolean }) {
  const mark = (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="nm-mark-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--nm-accent)" />
          <stop offset="100%" stopColor="var(--nm-accent-strong)" />
        </linearGradient>
      </defs>
      <rect x="5" y="11" width="38" height="26" rx="7" fill="url(#nm-mark-grad)" opacity="0.16" />
      <path
        d="M9 15.5c0-1.9 1.6-3.5 3.5-3.5h23c1.9 0 3.5 1.6 3.5 3.5v17c0 1.9-1.6 3.5-3.5 3.5h-23A3.5 3.5 0 0 1 9 32.5z"
        fill="none"
        stroke="url(#nm-mark-grad)"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path d="M11 16.5 24 26l13-9.5" fill="none" stroke="url(#nm-mark-grad)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M18.5 32.5 24 27l5.5 5.5" fill="none" stroke="url(#nm-mark-grad)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
  if (!withBackground) return mark
  return <div className="brand__mark">{mark}</div>
}
