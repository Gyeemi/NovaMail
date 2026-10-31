# Changelog

All notable changes to Novamail. Versions follow the Windows installer that was
built from them.

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
