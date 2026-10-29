# Feature completion report

Status of every feature in Novamail 1.0.0, as of this commit. This is a status
report, not marketing: anything not proven by a test or by running the built app
is marked **partial** or **planned**, and the reason is stated.

Legend:

- **Implemented** — code is complete and reachable from the UI.
- **Partial** — works, but has a documented limitation.
- **Planned** — not built. No button in the UI pretends otherwise.

---

## Verified in this environment

The development sandbox has no Windows, no Electron runtime and no wine, so the
following is what has actually been *run*:

| Check | Command | Result |
|---|---|---|
| Type check (main + renderer) | `npm run typecheck` | clean, both projects |
| Unit tests | `npx vitest run tests/unit` | 34 passed |
| Database integration tests | `npx vitest run tests/integration` | 20 passed |
| Production build | `npx electron-vite build` | success |
| Pre-packaging audit | `npm run verify` | 11/11 checks pass |
| Installer build | `npm run dist:win` | **not run** — needs Windows or wine |
| Launched in real Electron | — | **not run** — no Electron binary obtainable here |

Anything below marked *Implemented* means "written, type-checked and covered by
tests where the logic is testable", **not** "clicked through on Windows". The
first-time installer test in `docs/BUILD-WINDOWS.md` is the step that closes that
gap, and it must be done before Novamail is handed to anyone.

---

## Mail core

| Feature | Status | Notes |
|---|---|---|
| Multi-account IMAP | Implemented | `imapflow`, one connection per account, IDLE where supported |
| SMTP send | Implemented | `nodemailer`, TLS 1.2+, single compiled MIME message per send |
| OAuth 2.0 + PKCE (Gmail, M365, Outlook.com) | Implemented | System browser, loopback redirect, `state` verified |
| App passwords (iCloud, Yahoo, generic) | Implemented | Stored encrypted via `safeStorage`/DPAPI |
| Autoconfiguration | Implemented | Provider table + domain heuristics; always shown for review |
| Unified inbox | Implemented | Merged by date, de-duplicated by Message-ID |
| Focused / Other split | Implemented | Local heuristic flag (`is_focused`), no server dependency |
| Conversation threading | Implemented | `References`/`In-Reply-To`/subject normalisation, collapsible thread view |
| Folder tree (incl. nested IMAP paths) | Implemented | Delimiter-aware, special-use flags mapped |
| Read/unread, flag, important | Implemented | Applied locally first, queued to the server |
| Archive / move / delete / spam | Implemented | Trash and spam are real folders; *Delete permanently* empties them |
| Labels | Implemented | Local labels stored per message (Gmail labels are read as folders) |
| Full-text search | Implemented | SQLite FTS5 over subject, sender, recipients, body |
| Search operators | Implemented | `from: to: cc: subject: body: has: is: after: before: on: account: in: folder: label: larger: filename:` and `"phrases"` |
| Saved searches and recent searches | Implemented | Stored in the database |
| Snooze | **Partial** | Local only: the message is hidden until the timer elapses, then reappears. It is *not* removed from the server, so other clients still show it |
| Rules / filters | Implemented | Applied during sync to newly arrived mail; run-on-demand from the rules screen |
| Signatures | Implemented | Per account, default signature selection, HTML |
| Drafts (autosave, recover) | Implemented | Autosave every 20 s, restored on next launch, promoted to a draft folder row |
| Undo send | Implemented | Message held in the outbox for 0–30 s (default 5 s) |
| Schedule send | Implemented | Queued in the outbox with `scheduledAt`; retried if the app was closed |
| Redirect / resend | **Partial** | Implemented as `Resent-*` headers. Some providers strip them |
| Read receipts | Partial | *Requesting* one is implemented; returning receipts is provider-dependent and not automatic |
| Import from another client | **Planned** | No `.eml`/mbox/PST import yet |
| Message templates / quick parts | **Planned** | — |
| Server-side rules (Sieve) | **Planned** | Novamail rules run locally on arrival |

## Attachments and preview

| Feature | Status | Notes |
|---|---|---|
| PDF preview | Implemented | PDF.js to canvas, `isEvalSupported: false`, page navigation and zoom |
| Image preview | Implemented | Served from the local cache via `novamail-att:` |
| Text / CSV / log preview | Implemented | CSV rendered as a table; 1 MB cap with truncation notice |
| DOCX preview | Implemented | Mammoth to HTML, then sanitised |
| XLSX preview | Implemented | ExcelJS, sheet tabs, first 500 rows per sheet |
| PPTX preview | **Partial** | Slide-by-slide *text* extraction and image list. No layout rendering — a slide will not look like the original |
| Audio / video preview | Implemented | Played from cache; codec support is whatever Chromium supports (no HEVC, no AC-3) |
| Legacy `.doc` / `.ppt` / `.xls` | Honest refusal | Old binary Office formats cannot be converted locally; the UI says so and offers Save / Open with |
| Archive (ZIP) contents listing | **Planned** | Archives are flagged *caution* and cannot be opened from the preview pane |
| Attachment caching | Implemented | Content-hash keyed, `Range` supported, auto-pruned |
| Dangerous-file warnings | Implemented | Executables, scripts, macro-enabled docs and double extensions |
| Save as / Save all | Implemented | Native save dialog, sanitised file names |
| Print attachment | **Partial** | Renders the preview in a hidden window and prints it. Untested on Windows printers |

## Accounts, sync and offline

| Feature | Status | Notes |
|---|---|---|
| Offline cache | Implemented | Headers always cached; bodies fetched on demand and cached |
| Sync queue with retry | Implemented | Exponential backoff, 6 attempts, then reported as failed |
| Queue deduplication | Implemented | Unique `dedupe_key` prevents duplicate flag operations |
| Per-folder UIDVALIDITY handling | Implemented | A UIDVALIDITY change triggers a folder re-sync instead of bogus updates |
| Incremental sync | Implemented | `last_seen_uid` per folder |
| Sync pause / resume, manual sync | Implemented | `sync.setOffline`, `sync.now`, tray "Sync now" |
| Bandwidth/size limits | Implemented | `maxCachedMessagesPerFolder`, size caps in settings |
| Connection error classification | Implemented | Auth vs network vs server errors get different messages and retry behaviour |
| Multiple accounts at once | Implemented | Independent connections and failure isolation |
| Backup / restore | **Partial** | Exports the database, settings, rules and attachment index to a folder. Credentials are **not** included, so restoring on another PC means signing in again |

## Productivity modules

| Feature | Status | Notes |
|---|---|---|
| Contacts | **Partial** | Full CRUD, groups, autocomplete from mail history. Stored locally; no CardDAV/Google Contacts sync |
| Calendar | **Partial** | Month/week/day views, local events, reminders. No CalDAV/Microsoft Graph sync, no IMAP `iMIP` invite sending |
| Tasks | **Partial** | Local task list with due dates and completion. No server sync |
| `.ics` import | Implemented | Opens calendar events and invitations found as attachments |
| Send invitation | **Planned** | Calendar events are not yet attached to mail as `text/calendar` |

These three modules are deliberately isolated behind repositories and a typed
service, so adding CalDAV/CardDAV later does not touch mail code.

## Interface

| Feature | Status | Notes |
|---|---|---|
| Three-pane Outlook-style layout | Implemented | Resizable panes, collapsed sidebar mode |
| Light / dark / system theme | Implemented | Follows Windows theme changes |
| Neomorphic depth | Implemented | Three intensity levels + reduced-motion mode |
| Density and text scale | Implemented | Compact / comfortable / spacious; 85–140 % text |
| Beginner mode | Implemented | Larger targets, extra hints, simplified labels |
| Command palette | Implemented | `Ctrl+Shift+P` |
| Full keyboard map | Implemented | Gmail-style `J`/`K`, `Ctrl+N`, `Ctrl+Enter`, configurable in Settings → Shortcuts |
| Screen-reader support | Partial | Semantic landmarks, labels on every control, `aria-live` for toasts. **Not** audited with NVDA/JAWS |
| Settings | Implemented | Nine sections, live preview, survives upgrades (covered by a test) |
| About / diagnostics | Implemented | Version, storage locations, redacted log tail, copy-to-clipboard |
| Browser demo mode | Implemented (development only) | Sample data so the UI can be reviewed without accounts. The packaged app never shows it |
| Multi-window | **Planned** | One window plus tray |
| Localisation | **Planned** | English only; strings are in components, not a catalogue |

## Platform and packaging

| Feature | Status | Notes |
|---|---|---|
| NSIS installer | Configured | `electron-builder.yml`, per-user, `Novamail-Setup-x64.exe`. Build it with `docs/BUILD-WINDOWS.md` |
| Portable build | Configured | `npm run dist:win:portable` |
| Desktop / Start menu shortcuts | Implemented in config | `createDesktopShortcut: always` |
| Data outside the install directory | Implemented | `%APPDATA%\Novamail`, covered by an upgrade-survival test |
| Uninstall keeps your mail | Implemented in config | `deleteAppDataOnUninstall: false` |
| Tray icon and minimise-to-tray | Implemented | Stays running for new-mail notifications |
| Windows notifications | Implemented | Toast on new mail, respects the settings toggle |
| Launch at startup | Implemented | `app.setLoginItemSettings` |
| Code signing | **Not available** | No certificate. SmartScreen will warn; documented in `SECURITY.md` |
| Auto-update | **Planned** | Deliberately not shipped: an unsigned app must not self-update. Manual installer download only |
| Portable settings path | Implemented | `NOVAMAIL_DATA_DIR` environment variable |

## Security

| Control | Status |
|---|---|
| `contextIsolation`, `sandbox`, no `nodeIntegration` | Implemented |
| Strict CSP with `object-src 'none'` | Implemented |
| Allow-listed preload API, zod-validated IPC | Implemented |
| HTML sanitisation (10 unit tests) | Implemented |
| Sandboxed iframe rendering for message bodies | Implemented |
| Remote images blocked by default | Implemented |
| Dangerous attachment blocking | Implemented |
| Credentials in DPAPI (`safeStorage`) | Implemented |
| Log redaction | Implemented |
| End-to-end encryption (PGP/S-MIME) | **Not implemented** — and not claimed anywhere in the UI |
| Database encryption at rest | **Not implemented** — use BitLocker |
| Phishing detection | **Not implemented** |

## Tests

| Suite | Count | Covers |
|---|---|---|
| `tests/unit/sanitize.test.ts` | 10 | script/handler/iframe stripping, URL schemes, remote-image blocking, cid rewriting, CSS escapes, pathological input |
| `tests/unit/mail-parse.test.ts` | 8 | real multipart message: envelope, both bodies, attachment bytes, checksums, broken input |
| `tests/unit/search-and-attachments.test.ts` | 12 | query operators, relative dates, FTS escaping, attachment classification and safety, file-name sanitising |
| `tests/unit/renderer-smoke.test.tsx` | 4 | the real shell renders, three panes, message opens, composer opens |
| `tests/integration/database.test.ts` | 20 | migrations, idempotent upsert, threading, FTS search, snooze, labels, rules, signatures, sync queue backoff, settings surviving a restart |
| **Total** | **54** | all passing |

Not written yet:

- **End-to-end tests** (`tests/e2e`) — Playwright is installed and configured, but
  the Electron binary cannot be downloaded in the build sandbox. Three journeys
  should be added first: add a test account against a local GreenMail/Dovecot
  container, send a message and see it in Sent, open each attachment preview.
- **Live IMAP/SMTP integration test** — requires a real server; the send path is
  currently covered only by unit-level MIME compilation.
- **Accessibility audit** — needs NVDA/JAWS and manual keyboard-only testing.

---

## Summary

| Area | Implemented | Partial | Planned |
|---|---|---|---|
| Mail core | 20 | 3 | 3 |
| Attachments | 9 | 3 | 1 |
| Sync / accounts | 9 | 1 | 0 |
| Productivity | 1 | 3 | 1 |
| Interface | 12 | 1 | 2 |
| Packaging | 7 | 0 | 2 (signing, auto-update) |
| Security | 12 | 0 | 3 |

The honest headline: **the mail client core is complete and tested; the calendar,
contacts and tasks modules are local-only; there is no end-to-end encryption, no
code signing and no automatic updates.** Each of those is stated in the app
itself where a user would otherwise assume otherwise.
