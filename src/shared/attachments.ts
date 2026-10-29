/**
 * Novamail - attachment classification, safety rules and formatting helpers.
 * Pure functions shared by the main process and the renderer.
 */
import type { AttachmentKind, AttachmentSafety, PreviewType } from './types'

interface KindRule {
  kind: AttachmentKind
  extensions: string[]
  mimePrefixes?: string[]
}

const RULES: KindRule[] = [
  { kind: 'pdf', extensions: ['pdf'], mimePrefixes: ['application/pdf'] },
  {
    kind: 'image',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico', 'tif', 'tiff'],
    mimePrefixes: ['image/']
  },
  { kind: 'text', extensions: ['txt', 'log', 'md', 'json', 'xml', 'yml', 'yaml', 'ini', 'cfg', 'diff', 'patch'] },
  { kind: 'csv', extensions: ['csv', 'tsv'], mimePrefixes: ['text/csv'] },
  { kind: 'document', extensions: ['doc', 'docx', 'odt', 'rtf', 'pages', 'docm'] },
  { kind: 'spreadsheet', extensions: ['xls', 'xlsx', 'ods', 'numbers', 'xlsm'] },
  { kind: 'presentation', extensions: ['ppt', 'pptx', 'odp', 'key', 'pptm'] },
  { kind: 'audio', extensions: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'wma'], mimePrefixes: ['audio/'] },
  {
    kind: 'video',
    extensions: ['mp4', 'm4v', 'webm', 'ogv', 'mov', 'avi', 'mkv', 'wmv'],
    mimePrefixes: ['video/']
  },
  { kind: 'archive', extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz'] },
  { kind: 'email', extensions: ['eml', 'msg', 'mbox'], mimePrefixes: ['message/'] },
  { kind: 'calendar', extensions: ['ics'], mimePrefixes: ['text/calendar'] },
  { kind: 'contact', extensions: ['vcf'], mimePrefixes: ['text/vcard', 'text/x-vcard'] }
]

const DANGEROUS = new Set([
  'exe',
  'com',
  'bat',
  'cmd',
  'scr',
  'pif',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'hta',
  'cpl',
  'dll',
  'sys',
  'msi',
  'msp',
  'reg',
  'lnk',
  'url',
  'scf',
  'msc',
  'jar',
  'application',
  'gadget',
  'inf',
  'iso',
  'img',
  'vhd'
])

const MACRO_CAPABLE = new Set(['docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm', 'xlam', 'xla', 'doc', 'xls', 'ppt'])

export function extensionOf(filename: string): string {
  const clean = filename.toLowerCase().split(/[\\/]/).pop() ?? filename.toLowerCase()
  const dot = clean.lastIndexOf('.')
  if (dot <= 0 || dot === clean.length - 1) return ''
  return clean.slice(dot + 1)
}

/** Human label for a safety level, used by the reader and the preview dialog. */
export function safetyLabel(level: AttachmentSafety['level']): string {
  if (level === 'dangerous') return 'Blocked'
  if (level === 'caution') return 'Needs care'
  return 'No active content'
}

export function classifyAttachment(filename: string, mimeType: string): AttachmentKind {
  const ext = extensionOf(filename)
  const mime = (mimeType || '').toLowerCase()
  for (const rule of RULES) {
    if (ext && rule.extensions.includes(ext)) return rule.kind
  }
  for (const rule of RULES) {
    if (rule.mimePrefixes?.some((prefix) => mime.startsWith(prefix))) return rule.kind
  }
  return 'unknown'
}

export function evaluateSafety(filename: string, mimeType: string): AttachmentSafety {
  const ext = extensionOf(filename)
  const mime = (mimeType || '').toLowerCase()
  const doubleExtension = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|txt)\.(exe|scr|bat|cmd|js|vbs|com|pif|msi|lnk)$/i.test(
    filename
  )

  if (DANGEROUS.has(ext) || doubleExtension) {
    return {
      level: 'dangerous',
      reason: doubleExtension
        ? 'The file name hides an executable behind a second extension.'
        : `Files ending in .${ext} can run programs on your computer.`,
      executable: true,
      macroCapable: false
    }
  }
  if (MACRO_CAPABLE.has(ext)) {
    return {
      level: 'caution',
      reason: `Files ending in .${ext} can contain macros or scripts. Novamail never runs macros.`,
      executable: false,
      macroCapable: true
    }
  }
  if (ext === 'zip' || ext === '7z' || ext === 'rar' || ext === 'iso' || ext === 'img') {
    return {
      level: 'caution',
      reason: 'Archives can contain programs. Novamail does not extract archives automatically.',
      executable: false,
      macroCapable: false
    }
  }
  if (mime.startsWith('application/x-msdownload') || mime.startsWith('application/x-dosexec')) {
    return { level: 'dangerous', reason: 'This is a Windows program.', executable: true, macroCapable: false }
  }
  return { level: 'safe', reason: null, executable: false, macroCapable: false }
}

/** Which viewer Novamail will use, and whether it is a full or partial preview. */
export function previewTypeFor(filename: string, mimeType: string): { type: PreviewType; limitation: string | null } {
  const ext = extensionOf(filename)
  const kind = classifyAttachment(filename, mimeType)
  if (evaluateSafety(filename, mimeType).level === 'dangerous') {
    return {
      type: 'unsupported',
      limitation: 'Executable files are never opened or previewed by Novamail.'
    }
  }
  switch (kind) {
    case 'pdf':
      return { type: 'pdf', limitation: null }
    case 'image':
      if (['tif', 'tiff'].includes(ext)) {
        return { type: 'unsupported', limitation: 'TIFF images are not supported by the built-in viewer. Open with your image app.' }
      }
      return { type: 'image', limitation: null }
    case 'text':
      return { type: 'text', limitation: null }
    case 'csv':
      return { type: 'spreadsheet', limitation: null }
    case 'spreadsheet':
      if (ext === 'xlsx') return { type: 'spreadsheet', limitation: null }
      return {
        type: 'unsupported',
        limitation:
          'Legacy Excel (.xls) and OpenDocument spreadsheets need a conversion step. Novamail shows the file details instead.'
      }
    case 'document':
      if (ext === 'docx') return { type: 'html', limitation: null }
      if (ext === 'rtf') return { type: 'unsupported', limitation: 'RTF files are not previewed. Open with your word processor.' }
      return {
        type: 'unsupported',
        limitation: 'Legacy Word (.doc) and OpenDocument text need a converter. Novamail shows the file details instead.'
      }
    case 'presentation':
      if (ext === 'pptx') return { type: 'slides', limitation: null }
      return {
        type: 'unsupported',
        limitation: 'Legacy PowerPoint (.ppt) files need a converter. Novamail shows the file details instead.'
      }
    case 'audio':
      if (['wma', 'aac'].includes(ext)) {
        return { type: 'unsupported', limitation: 'This audio format is not supported by the built-in player.' }
      }
      return { type: 'audio', limitation: null }
    case 'video':
      if (['avi', 'mkv', 'wmv', 'mov'].includes(ext)) {
        return {
          type: 'video',
          limitation: 'Playback depends on the codec. If the video does not start, open it with your media player.'
        }
      }
      return { type: 'video', limitation: null }
    case 'email':
      if (ext === 'eml') return { type: 'email', limitation: null }
      return { type: 'unsupported', limitation: 'Only .eml messages can be previewed. Open .msg files with Outlook.' }
    default:
      return {
        type: 'unsupported',
        limitation: 'Novamail cannot display this file type. You can still save it or open it with another app.'
      }
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[index]}`
}

/** Removes anything that could escape the cache directory or confuse Windows. */
export function safeFilename(filename: string, fallback = 'attachment'): string {
  const base = (filename || '').split(/[\\/]/).pop() ?? fallback
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i
  const name = reserved.test(cleaned) ? `_${cleaned}` : cleaned
  return (name || fallback).slice(0, 150)
}

export const DANGEROUS_EXTENSIONS = [...DANGEROUS]
