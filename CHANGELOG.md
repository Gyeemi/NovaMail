# Changelog

All notable changes to Novamail. Versions follow the Windows installer that was
built from them.

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
