# Changelog

All notable changes to Novamail. Versions follow the Windows installer that was
built from them.

---

## 1.0.3 — account management and OAuth sign-in

### Fixed

- **"Manage accounts" had nothing to manage.** There was no way to sign an
  existing account in again: Settings → Accounts offered test, default, revoke and
  remove, but reconnecting an account had to go through the add-account wizard,
  which could relabel one mailbox as another. Every OAuth account now has a
  **Sign in again / Reconnect** button that re-runs that provider's flow for that
  account only, with live progress and a **Cancel** button while the browser is
  open.
- **Google and Microsoft sign-in reported "not configured" with no way out.**
  The service ignored the client-ID file it wrote itself, and no screen could
  write it. Both are fixed: a new **Sign-in providers (OAuth)** section in
  Settings → Accounts saves a Google client ID and a Microsoft client ID + tenant,
  shows **Ready / Not configured**, and explains the exact loopback redirect to
  register. The client ID is stored in `%APPDATA%\Novamail\oauth.json` (0600);
  tokens still go only to the DPAPI-backed credential store.
- **Revoking access left the account looking connected.** It now clears the
  tokens, marks the account **Sign in needed** with an explanation, and asks the
  provider to invalidate the refresh token.
- **Sign-in failures were silent or misleading.** A failed re-authorisation marks
  the account `auth-required` with the provider's message; a cancellation is
  reported as a cancellation (not an error, not a success); a mismatched mailbox
  is refused with a message naming both addresses; a provider error body is no
  longer mistaken for a successful token response.
- **An account could not be edited at all.** There was no way to correct a
  display name, server or port, and no way to change a password for an
  app-password account — even though the reconnect message told the user to do
  exactly that. Each account now has an **Edit** dialog for name, username, IMAP
  and SMTP settings, and (for password accounts only) a new password; OAuth
  accounts point at Sign in again instead of showing an impossible field.
- **OAuth cancellation had no implementation** even though the IPC result type
  had a `cancelled` field. `cancelOAuth` now interrupts the loopback wait, closes
  the listener and resolves the flow cleanly (no unhandled rejection).

### Added

- `accounts.reconnect`, `accounts.cancelOAuth`, `accounts.oauthStatus` and
  `accounts.setOAuthClient` over IPC (validated, preload allowlist updated, and
  implemented in the browser demo bridge).
- `accounts:changed` event so every window repaints account badges immediately.
- 30 new tests: 10 exercise the real loopback listener and PKCE exchange against a
  stubbed provider (PKCE challenge, state mismatch, provider denial, cancellation,
  `invalid_grant`, tenant handling, client-ID masking), 14 cover the account
  management logic, 6 drive the Settings screen through the UI.
- Account setup guide: how to register the Google and Microsoft apps, the redirect
  addresses, and what each account action does.

### Verified

- `npm run typecheck`, `npx vitest run` (105 tests, 11 files), `electron-vite
  build` and `scripts/verify-build.mjs` all pass.
- Google and Microsoft sign-in could not be completed against the live providers
  in the build environment (no browser, no registered client IDs); the flow is
  covered end-to-end with a stubbed provider instead. See the feature report.

---

## 1.0.2 — layout repair

### Fixed

- **The top bar had no layout.** `.topbar__left`, `.topbar__search` and
  `.topbar__right` were never defined in CSS, so each region's children stacked
  vertically. That is why Compose floated over the browser-preview banner and the
  notification bell, settings gear and account button appeared to sit inside the
  reading pane. All three regions are now proper flex rows.
- **Message rows wrapped their action buttons onto a second line.** The row grid
  reserved three columns while the markup has four (checkbox, avatar, body,
  actions). The fourth column now exists.
- **79 classes used by the components had no CSS at all**, covering the popovers,
  the composer's header/fields/footer, the spreadsheet and slide previews, the
  settings sidebar, the setup wizard and the attachment toolbar. They all fall
  back to sensible defaults now.
- **Narrow windows squeezed three panes into less width than they need.** Below
  900 px the sidebar becomes an icon rail and the reading pane slides over the
  message list, with a Back button in the reader toolbar. Below 760 px the list
  is single column, the footer hides and toasts span the window.
- Brand name and tagline ran together ("NovamailEmail, made effortless"): the
  tagline class was unstyled and the text was one line.

### Added

- `tests/unit/classnames.test.ts` — fails the build if any `className` used in
  the renderer has no matching rule, so this class of bug cannot ship again.
- Shell structure assertions in the renderer smoke test: banner above the top
  bar, the three top-bar regions, four list-item columns, and the reader Back
  control.

Tests: 72 (was 67).

---

## 1.0.1 — typing fix

### Fixed

- **Dialogs accepted only one character.** After the first keystroke in any
  Novamail dialog (add account, rule editor, contact editor, message dialogs),
  focus jumped to the dialog's *Close* button, so further typing went nowhere.
  Two defects combined:
  - `Modal` opened with `<button>` first in the focus order, so the header close
    button received focus instead of the first field.
  - The focus effect depended on `onClose`, which every caller passes as an
    inline arrow. A new function identity on every render re-ran the effect after
    each keystroke and re-applied that focus.
  The effect now runs once on open, holds the close callback in a ref, and
  focuses the first real form field (or an element marked `data-autofocus`).
- **Typing `/` in the composer jumped the caret to search.** The `/` shortcut
  checked `INPUT`/`TEXTAREA` but not `contentEditable`, which is what the compose
  body is.

### Tests

- New `tests/unit/modal-typing.test.tsx` (4 tests) types a full email address
  into a modal and asserts focus stays put. It fails against the 1.0.0 code with
  `expected <button> to be <input>`.
- New app-level smoke test types an entire search query character by character.
- 59 tests total (was 54).

---

## 1.0.0 — first build

- Initial release: multi-account IMAP/SMTP, OAuth 2.0 with PKCE, unified inbox,
  threading, search with operators, rules, signatures, drafts, undo-send,
  schedule-send, snooze, attachment preview engine (PDF, image, text/CSV, DOCX,
  XLSX, PPTX, audio, video), contacts/calendar/tasks modules, nine settings
  sections, NSIS installer.
- 54 tests. First installer produced by the Windows CI workflow from tag
  `v1.0.0`.
