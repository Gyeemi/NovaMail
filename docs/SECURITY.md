# Security

This document describes what Novamail protects against, how, and what it does
**not** protect against. Read the last section before trusting it with anything
important.

---

## Threat model

Email is hostile input. Novamail assumes:

1. **Message content is attacker-controlled.** Any HTML, MIME structure, file
   name or attachment can be crafted to attack the client.
2. **The network is hostile.** Server connections may be intercepted.
3. **The local machine is trusted.** Novamail does not defend against malware or
   an attacker already running code as your Windows user. It does defend
   credentials against casual file inspection and backups.
4. **The mail provider is trusted with your mail.** Novamail cannot hide message
   contents from the server that stores them.

---

## Process isolation

| Control | Setting | Why |
|---|---|---|
| Context isolation | `contextIsolation: true` | Renderer JavaScript cannot touch Node.js or preload internals |
| Node integration | `nodeIntegration: false` | No `require`, no filesystem, no child processes in the UI |
| Sandbox | `sandbox: true` | Renderers run in OS-level Chromium sandboxes |
| Webviews | `webviewTag: false` | No embedded browsers with relaxed settings |
| DevTools | disabled in production | Reduces remote-debugging surface |
| New windows | denied | `window.open` cannot spawn an unmanaged window |
| Navigation | blocked | Navigating away from the app is cancelled; links open in the default browser |
| Permissions | denied by default | Camera, geolocation, MIDI, serial, USB are refused; only notifications and clipboard-write are granted |
| WebSQL | disabled | Removes an unused storage engine |

The preload script (3.1 kB) exposes a **fixed allow-list** of IPC channels.
There is no generic `invoke(channel, ...args)` escape hatch: the renderer can only
call the named methods in the `NovaMailBridge` interface.

Every IPC payload is validated with **zod** in the main process before use, so a
compromised renderer cannot pass malformed or oversized arguments into the
database or the network stack.

---

## Content Security Policy

Applied both as a response header in the main process and as a `<meta>` tag in
`index.html`:

```
default-src 'none';
script-src 'self';
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: novamail-att:;
font-src 'self' data:;
media-src novamail-att: blob: data:;
frame-src 'self';
connect-src 'self' ws:;
object-src 'none';
base-uri 'none';
form-action 'none'
```

`object-src 'none'`, `base-uri 'none'` and `form-action 'none'` are the important
ones: no plugins, no `<base href>` hijacking, no exfiltration through forms.
`'unsafe-inline'` is limited to styles, which cannot execute code.

---

## Rendering received HTML

Two independent layers, so a bug in one is not enough for code execution:

1. **Sanitisation** (`sanitize-html`, allow-list based) in the main process:
   - `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`,
     `<input>`, `<link>`, `<meta>`, `<base>` are removed with their content
   - all `on*` event attributes are stripped
   - `href` is rebuilt from scratch; only `http:`, `https:`, `mailto:`, `tel:` and
     `#anchor` survive — `javascript:` and `data:` are dropped
   - CSS `position`, `z-index` and similar layout escapes are removed so a
     message cannot draw a fake login box over Novamail's own UI
2. **Sandboxed iframe**: sanitised HTML is rendered in an iframe with
   `sandbox="allow-popups allow-popups-to-escape-sandbox"` (no `allow-scripts`,
   no `allow-same-origin`), `referrerPolicy="no-referrer"`, and its own inner CSP
   `default-src 'none'; img-src novamail-att: data:; style-src 'unsafe-inline';
   form-action 'none'`.

Result: message markup has no scripting capability and cannot reach Novamail's
own DOM.

---

## Remote images and tracking pixels

Remote images are **blocked by default**. Every blocked image is replaced with a
1×1 transparent pixel; the original URL is kept in a `data-` attribute so the
message can be re-rendered after you click **Show images**. That prevents read
receipts and IP-address harvesting by tracking pixels. Showing images is a
per-message decision, not global.

Inline (`cid:`) images are served from the local cache through the custom
`novamail-att://` protocol — never from the network.

The `novamail-att:` protocol:

- serves only files registered in the attachments table of the open database
- sends `X-Content-Type-Options: nosniff`
- sends `Content-Disposition` and validates the requested byte range
- refuses any path outside the app's cache directory

---

## Attachments

- Attachments are **never executed**. Nothing is passed to `ShellExecute` unless
  you explicitly choose *Open with…*.
- Files flagged **dangerous** (executables, scripts, double extensions such as
  `invoice.pdf.exe`) cannot be opened from the preview pane at all.
- Files flagged **caution** (archives, macro-enabled documents) require a second
  confirmation before opening.
- The preview engine reads files; conversion for DOCX/XLSX/PPTX happens **locally**
  (Mammoth, ExcelJS, JSZip). Nothing is uploaded to a third-party service.
- PDF rendering uses PDF.js with `isEvalSupported: false`, so PDF-embedded
  JavaScript cannot execute. PDFs are rendered to canvas only.
- The cache lives in `%APPDATA%\Novamail\cache\attachments`, is keyed by content
  hash, and is pruned automatically (`Settings → Privacy`).

---

## Credentials

| What | Where |
|---|---|
| Passwords / app passwords | encrypted with Electron `safeStorage` (Windows DPAPI, per-user) in `credentials.json` |
| OAuth refresh + access tokens | same encrypted store |
| OAuth client secrets | not present — Novamail uses PKCE public clients, so there is no secret to leak |
| Database | contains no passwords or tokens, ever |

`safeStorage` is unavailable on some Linux setups; there Novamail falls back to a
key derived and stored with 0600 permissions and **tells you so in Diagnostics**.
On Windows, DPAPI is always available and the fallback is never used.

Credential blobs are decrypted only when a connection is opened, and are never
written to logs. Deleting an account deletes its blobs.

---

## OAuth 2.0

- Authorization Code flow with **PKCE** (S256), `state` parameter verified.
- The authorization request opens in the **system browser**, never in an embedded
  webview — an embedded browser would let a malicious page read your session.
- The redirect is received on a loopback listener bound to `127.0.0.1` on a random
  port and validated against the expected `state`.
- Requested scopes are the minimum needed for mail. No contacts/calendar scopes
  are requested.
- Novamail is **not** a Google-verified or Microsoft-verified app, so the consent
  screen shows an "unverified app" warning you must accept. That is a
  consequence of self-hosting, not a sign of tampering. Verify you built the
  binary yourself or obtained it from a source you trust.

---

## Logging and redaction

- Passwords, tokens, cookies and full message bodies are **never logged**.
- A redaction filter runs over every log line and covers `password`, `pass`,
  `token`, `secret`, `authorization`, `cookie`, bearer strings and base64 blobs.
- Logs rotate and are stored in `%APPDATA%\Novamail\logs`.
- The Diagnostics screen shows the redacted log tail so it can be pasted into a
  bug report safely.

---

## Database

- WAL mode with `synchronous=NORMAL` (safe from corruption on crash; the last
  transaction may be lost on power failure, which is acceptable for cached mail).
- `secure_delete=ON` so deleted message bodies do not linger in free pages.
- Foreign keys on, so deleting an account removes its cached mail.
- **The database is not encrypted at rest.** See the limitations below.

---

## Code signing

**The installer is not code-signed.** There is no certificate for this project.

Consequences you should be aware of:

- Windows SmartScreen shows *"Windows protected your PC"* on first run, and again
  after an update that changes the binary.
- Windows cannot verify that the `.exe` came from Baraily Inovex.
- Antivirus software may flag an unsigned Electron app heuristically.
- Novamail therefore ships **no auto-updater**. Downloading and running a new
  installer is always an explicit decision by you, so an unsigned binary cannot
  be delivered silently by an attacker who compromises an update feed.

If you distribute Novamail inside an organisation, sign it with an
Extended Validation or organisation certificate before rollout; electron-builder
supports this through `win.signingHashAlgorithms`, `CSC_LINK` and `CSC_KEY_PASSWORD`.

---

## What Novamail does NOT protect against

Stated plainly, because pretending otherwise would be dishonest:

1. **No end-to-end encryption.** Novamail does not implement PGP, S/MIME or any
   message encryption. Mail is readable by your provider. The UI does not claim
   otherwise anywhere.
2. **No encryption of local data.** Anyone with access to your Windows account
   (or your backup files) can read `novamail.db` with any SQLite browser. Use
   BitLocker if this matters.
3. **A compromised operating system defeats all of the above.** Malware running
   as your user can read DPAPI secrets and the database.
4. **No protection against a malicious mail server.** It sees your mail.
5. **No sandboxing of external programs.** If you choose *Open with…* for an
   attachment, Windows handles it with the registered application; a viewer with
   a vulnerability can be exploited. Prefer the built-in preview.
6. **No certificate pinning.** TLS 1.2+ with normal certificate validation is
   used; a trusted-but-malicious CA could intercept.
7. **HTML email is rendered, not rewritten.** Layout can still be ugly or
   misleading in intent (phishing text), even though it cannot execute code.
   Novamail does not detect phishing for you.

---

## Reporting a vulnerability

Contact `support@barailyinovex.example` with reproduction steps. Please do not
open a public issue for a security problem. There is no bug bounty.
