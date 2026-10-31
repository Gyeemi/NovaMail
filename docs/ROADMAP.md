# Roadmap

Ordered by what blocks real-world use first, not by what is fun to build.

---

## 1.0 — Release readiness (next)

The code is written; these are the steps that make it shippable.

1. **Build the installer on Windows** and run the verification checklist in
   `docs/BUILD-WINDOWS.md` (install, launch, add account, upgrade, uninstall).
   Nothing below matters until this passes.
2. **Test against real providers** with dedicated accounts: Gmail (OAuth), a
   Microsoft 365 tenant, iCloud with an app password, and one generic Dovecot.
   Send, receive, move, flag, search, and open every attachment kind.
3. **End-to-end tests** for the three journeys that break most often: adding an
   account, sending a message, previewing an attachment. Requires a containerised
   IMAP/SMTP server (GreenMail or Dovecot + Postfix).
4. **Accessibility pass** with NVDA and a keyboard only — no mouse. Fix focus
   order, announce dynamic changes, verify contrast at 140 % text scale.
5. **Code signing certificate** (OV or EV), then turn on signed releases and
   remove the SmartScreen warning from the docs.
6. **Crash handling:** a last-known-good marker so a database that fails to open
   offers restore-from-backup instead of an error box.

## 1.1 — Polish that users will notice

- **Calendar sync**: CalDAV (Fastmail, Nextcloud, iCloud app password) and
  Microsoft Graph for M365. The data model already exists.
- **CardDAV contacts sync**, and import from a CSV/vCard file.
- **Calendar invitations in mail**: recognise `text/calendar` parts, offer
  Accept / Tentative / Decline, and send `iMIP` replies.
- **`.doc`, `.ppt`, `.xls` preview** via a bundled converter, or a clearer
  "install Office / use LibreOffice" path. Only if it can be done locally.
- **Archive preview**: list ZIP contents, extract single files with size limits.
- **Message templates / quick parts** and a snippet manager.
- **Import**: `.eml`, `.mbox`, and Thunderbird profile import.

## 1.2 — Power features

- **Sieve support** so rules run on the server even when the app is closed.
- **Unified conversation view across accounts** (already grouped, needs UI work).
- **Quick filters** (has attachment, from contact, this week) as one-click chips.
- **Print a whole conversation**, and print preview.
- **Attachment "save all to folder"** with a single dialog.
- **Split view for two messages** side by side.
- **Custom folders and smart folders** (saved searches surfaced as folders).

## 1.3 — Security and trust

- **Database encryption at rest**, keyed from DPAPI, with a documented recovery
  path (losing the key means losing cached mail — hence opt-in).
- **S/MIME** (sign and verify) — realistic without a server. PGP is harder:
  key discovery and Web-of-Trust UX are a project of their own, and claiming
  "encrypted" while being wrong is worse than not offering it.
- **Phishing indicators**: display-name/domain mismatch, punycode warning,
  first-contact banner, link destination preview on hover.
- **Signed auto-update** once signing exists: electron-updater with a feed, staged
  rollout, and rollback.

## 2.0 — Beyond email

- Multi-window and per-account windows.
- Localisation (string catalogue, RTL layout).
- macOS and Linux builds (the code is already platform-neutral except the
  credential-store fallback and NSIS config).
- Outlook PST import.
- Shared-mailbox and delegation support for Microsoft 365.

---

## Explicitly out of scope

Saying no on purpose:

- **A Novamail cloud service.** No sync server, no web client, no account system.
  Mail stays on your machine and on your provider.
- **Telemetry.** Even opt-in analytics would change the privacy story, and it is
  not needed to make a better mail client. Crash reports are a log file you
  choose to send.
- **Browser extension or mobile app.** Different product, different threat model.
- **Built-in AI summarisation** unless it can run fully offline; sending mail
  bodies to a third-party API conflicts with `docs/PRIVACY.md`.
- **Ads, or "promoted" inbox slots.** Obviously.

---

## Known technical debt

Recorded so it is not forgotten:

| Item | Why it matters |
|---|---|
| `src/main/index.ts` is ~600 lines | Should be split into window, tray, menu, protocol and lifecycle modules |
| No per-folder concurrency limit in the sync engine | A mailbox with 200 folders will open 200 IMAP connections; needs a queue with a cap |
| Attachment preview conversion runs on the main thread | A large DOCX can stall the UI; move Mammoth/ExcelJS into a worker |
| `mockBridge.ts` duplicates the API shape | It is checked by the renderer smoke test, but a type-level assertion would be stronger |
| Settings mirror file has no version field | Add one before the first schema change that matters |
| No migration test from an "old" fixture database | The append-only migration policy is only tested forward, not from a real 0.9 file |
