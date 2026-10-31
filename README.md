# Novamail

**Email, made effortless.**

Novamail is a desktop email client for Windows built by **Baraily Inovex**.
Multi-account IMAP/SMTP with OAuth 2.0, a focused inbox, conversation view,
attachments you can actually preview, and a calm interface that does not get in
the way. Your mail stays on your machine.

> **Current state:** the application source, tests and packaging configuration
> are complete and committed. A signed, downloadable `.exe` is **not** included
> in this repository — it is a compiled artifact. See
> [Building the Windows installer](docs/BUILD-WINDOWS.md) for the three ways to
> produce `Novamail-Setup-x64.exe` (GitHub Actions is the quickest: one click,
> no local toolchain).

---

## Features

**Mail**
- Unified inbox, Focused/Other split, per-account folders, conversation threading
- Read, unread, flag, important, archive, spam, delete, move, labels
- Reply, reply-all, forward, redirect; plain-text and HTML compose
- Drafts autosaved every 20 s, restored after a crash or restart
- Undo send (default 5 s, adjustable 0–30 s) — the message is held in the outbox
  until the countdown expires
- Schedule send, snooze with a reminder, signatures per account
- Rules engine: conditions on sender/recipient/subject/body/size/attachments,
  actions to move, label, flag, mark read, delete
- Search with operators (`from:`, `to:`, `subject:`, `has:attachment`,
  `is:unread`, `after:`, `larger:`, `filename:`, `"exact phrase"`), backed by
  SQLite FTS5 over subjects, senders, recipients and bodies

**Attachments** — previewed without downloading or opening external programs
- PDF (rendered with PDF.js; JavaScript evaluation disabled)
- Images, audio, video (served from the local cache only)
- Text and CSV (as a table)
- DOCX (Mammoth), XLSX (ExcelJS sheets), PPTX (slide text) — converted locally,
  never uploaded anywhere
- Everything else: clear "cannot preview" message plus *Save* / *Open with*
- Executables, macro-enabled documents and double extensions are flagged before
  they can be opened

**Accounts**
- Gmail, Microsoft 365, Outlook.com, iCloud, Yahoo and generic IMAP/SMTP
- OAuth 2.0 with PKCE in the system browser — Novamail never asks for a Google
  or Microsoft password
- App passwords for providers that require them, with IMAP/SMTP autoconfiguration
  that you can review and correct before saving
- Credentials are stored in the Windows credential store (DPAPI via Electron
  `safeStorage`), never in the database and never in plain text

**Also included**
- Contacts, calendar and tasks modules (local, calDAV-ready data model)
- Offline cache with a persistent sync queue (exponential backoff, deduplication)
- Backup/restore of settings, rules and local data
- Light/dark themes, neomorphic depth, density, text scale, beginner mode
- Full keyboard navigation, command palette, screen-reader labels
- Diagnostics and log viewer that redact secrets

---

## Requirements

- Windows 10 or 11, x64
- An email account with IMAP/SMTP
- For building only: Node.js ≥ 22.12

---

## Getting the installer

**Fastest — GitHub Actions:**

1. Open the **Actions** tab → **Build Windows installer** → **Run workflow**.
2. Download the `Novamail-Setup-x64` artifact when the job turns green.

**On your own Windows machine:**

```powershell
git clone https://github.com/Gyeemi/NovaMail.git
cd NovaMail
npm ci
npm run dist:win
# -> release\Novamail-Setup-x64.exe
```

Full instructions, including offline/portable builds and troubleshooting, are in
**[docs/BUILD-WINDOWS.md](docs/BUILD-WINDOWS.md)**.

### Installing

Run `Novamail-Setup-x64.exe`. It is a per-user install, so it does not need
administrator rights, and it can be installed to any folder.

The installer is **not code-signed**. Windows SmartScreen will show *"Windows
protected your PC"* the first time: click **More info → Run anyway**. Novamail
does not phone home and does not include an auto-updater, so an unsigned binary
cannot be silently replaced by anyone but you.

### Upgrading, and where your data lives

Everything mutable lives in `%APPDATA%\Novamail\`, never in the installation
folder:

```
%APPDATA%\Novamail\
  novamail.db          SQLite database (messages, folders, rules, settings)
  credentials.json     encrypted credential blobs (DPAPI)
  settings.json        readable copy of non-secret settings
  logs\                rotating structured logs (secrets redacted)
  cache\attachments\   attachment cache, pruned automatically
  backups\             backups you create
```

Installing a newer version over an older one replaces only program files, so
accounts, settings and cached mail survive. Uninstalling deliberately leaves the
folder in place; delete it yourself for a clean slate.

---

## Development

```bash
npm ci
npm run dev            # Electron with hot reload
npm run dev:renderer   # UI only, in a browser, with sample data (port 5199)
npm test               # vitest: unit + SQLite integration tests
npm run typecheck      # both TypeScript projects
npm run verify         # pre-packaging checks
npm run build          # production bundles in out/
npm run dist:win       # NSIS installer in release/
```

### Project layout

```
src/
  main/                 Electron main process (Node)
    db/                 migrations + repositories (accounts, messages, rules ...)
    services/           imap, smtp, sync, search, attachments, oauth, backup, rules
    ipc/                typed, validated IPC handlers
    util/               paths, logging, redaction, ids, mime
  preload/              minimal allow-listed bridge (contextIsolation, sandbox)
  renderer/src/         React UI
    components/         ui kit, mail list, reading pane, composer, previews
    views/              settings, setup wizard, rules, contacts, calendar, tasks
    state/              app provider (data + actions)
    styles/             design tokens and application CSS
  shared/               types, IPC contract, provider table, attachment rules
tests/
  unit/                 sanitiser, MIME parsing, search, renderer smoke test
  integration/          real SQLite: migrations, repositories, FTS, sync queue
build/                  icons for the installer and tray
docs/                   build, account setup, security, privacy, features
```

### Verified commands

| Command | Result |
|---|---|
| `npm run typecheck` | clean (both projects) |
| `npx vitest run` | 59 passed (39 unit, 20 SQLite integration) |
| `npx electron-vite build` | success — main 466 kB, preload 3.1 kB, renderer 896 kB |
| `npm run verify` | 11/11 checks pass |
| `npx electron-builder --win nsis` | **not run here** — needs a Windows runner or wine |

---

## Documentation

- [Building the Windows installer](docs/BUILD-WINDOWS.md)
- [Account setup guide](docs/ACCOUNT-SETUP.md) — Gmail, Microsoft 365, Outlook.com, generic
- [Security](docs/SECURITY.md) — threat model, what Novamail does and does not protect
- [Privacy](docs/PRIVACY.md) — every network connection the app makes
- [Feature status](docs/FEATURES.md) — implemented / partial / planned, honestly
- [Roadmap](docs/ROADMAP.md)
- [Working with Figma designs](docs/DESIGN-WORKFLOW.md)
- [Dependencies and licences](DEPENDENCIES.md)

---

## Licence

Proprietary, © 2026 Baraily Inovex. See [LICENSE](LICENSE).
Third-party open-source components are listed in [DEPENDENCIES.md](DEPENDENCIES.md)
and keep their own licences.
