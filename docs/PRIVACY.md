# Privacy

Novamail is a local application. There is no Novamail account, no Novamail
server and no telemetry.

---

## The short version

- Your mail, contacts, calendar and settings are stored **only** on your PC.
- Novamail has **no analytics, no crash reporting, no usage tracking and no ads.**
- Novamail **does not phone home.** It contacts your mail servers, and nothing else.
- Nothing you do in Novamail is visible to Baraily Inovex.

---

## Every network connection the app can make

| Destination | When | Data sent | Why |
|---|---|---|---|
| Your IMAP server | On start, every sync interval, when you open a folder | Login (OAuth token or app password), IMAP commands | Receive mail |
| Your SMTP server | When you send | Message envelope and content, login | Send mail |
| `accounts.google.com` / `login.microsoftonline.com` | When you add or re-authorise an account | PKCE challenge, requested scopes | OAuth sign-in, opened in your system browser |
| Your provider's autoconfig endpoint | Only when you type a new address in the wizard | Domain name | Prefill IMAP/SMTP settings |
| Remote images in a message | **Only after you click "Show images"** for that message | HTTP request to the image host | Display the images you asked for |
| Links you click | When you click | Opened in your default browser, subject to that browser's privacy | Your browser, not Novamail |

Connections **not** made:

- No update check against a Baraily Inovex server (there is no auto-updater).
- No license activation or heartbeat.
- No fonts, scripts, icons or CSS fetched from a CDN. Everything is bundled.
- No third-party file conversion service. DOCX/XLSX/PPTX/PDF are converted
  locally on your machine.
- No cloud backup. Backups are files you write to a folder you choose.

The optional **Check for updates** button in Settings → About is disabled in this
build because no update feed is configured; it will report that no feed is
available rather than contacting an unexpected host.

---

## What is stored on your computer

Everything is under `%APPDATA%\Novamail\`:

| File / folder | Contents | Sensitive? |
|---|---|---|
| `novamail.db` | Message headers and bodies, folders, labels, drafts, rules, contacts, calendar, tasks, settings, sync queue | **Yes** — your mail |
| `credentials.json` | Encrypted passwords/tokens (DPAPI) | **Yes**, but encrypted to your Windows user |
| `settings.json` | Readable copy of non-secret settings | No |
| `logs\` | Diagnostic logs, secrets redacted | Low |
| `cache\attachments\` | Downloaded attachments, pruned automatically | **Yes** — same sensitivity as mail |
| `backups\` | Backups you create | **Yes** |

Nothing is written to the installation directory (`Program Files` or
`%LOCALAPPDATA%\Programs\Novamail`) except program files, so an uninstall or an
upgrade never touches your data.

To delete everything: uninstall Novamail, then delete `%APPDATA%\Novamail`.
Uninstalling deliberately leaves that folder so a reinstall does not lose mail.

---

## What you send to other people

Mail you send goes through your own mail provider, exactly as it would from any
other client. Your signature, time zone and IP address may be visible to
recipients depending on your provider. Novamail does not add tracking pixels,
open tracking, or a "sent with Novamail" footer.

The one header Novamail adds is a standard `Message-ID`, plus `X-Priority` and
`Disposition-Notification-To` if you set importance or request a read receipt.

---

## Read receipts

Requesting a read receipt adds a `Disposition-Notification-To` header. Whether
the recipient honours it is entirely up to their client. Novamail does **not**
return read receipts by default; if your provider sends one, that is the
provider's behaviour, not Novamail's. The setting
*Settings → Privacy → Request read receipts* only controls outgoing requests.

---

## Children's data, GDPR and similar

Novamail processes no personal data on behalf of Baraily Inovex, because no data
reaches Baraily Inovex. If you install Novamail in an organisation, **you** are
the controller for the mail it stores locally, and responsible for device
encryption, backups and retention. Relevant exports:

- **Access / portability:** message data is ordinary SQLite plus standard
  attachments on disk; *Settings → Data → Export backup* produces a single
  archive.
- **Erasure:** delete an account (removes its local cache and credentials) or
  delete `%APPDATA%\Novamail` entirely.
- **Retention:** *Settings → Privacy → Delete preview cache after N days*.
  Message retention follows your provider.

---

## Changes to this policy

This file is part of the source tree, so any change to Novamail's network
behaviour appears as a diff to `docs/PRIVACY.md`. If a future version adds
telemetry, it will be off by default and documented here first.
