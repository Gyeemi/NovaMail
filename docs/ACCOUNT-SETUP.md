# Account setup guide

Novamail talks to your mail server directly using IMAP (receive) and SMTP
(send). There is no Novamail server in the middle.

Before you start, know your email address and — for providers that still use
passwords — an **app password**, not your normal account password. Novamail never
asks for a Google or Microsoft password: those providers require OAuth, which
opens your system browser instead.

Open the app and the setup wizard appears, or use **Settings → Accounts → Add
account**.

---

## Gmail / Google Workspace

Gmail requires OAuth 2.0. An app password also works if your account has 2-step
verification enabled, but OAuth is the supported path.

### Option A — OAuth (recommended)

1. Choose **Gmail** in the wizard and enter your address.
2. Click **Continue with Google**. Your default browser opens Google's consent
   screen. Novamail is not a Google-verified app, so you will see
   *"Google hasn't verified this app"*: click **Advanced → Go to Novamail
   (unsafe)**. This warning means the app has not paid for Google's verification
   review; it does not mean anything is wrong with the code you just built.
3. Approve **read, send, modify** mail access. The browser shows
   *"You can close this window"*; return to Novamail.
4. Novamail exchanges the code for tokens using PKCE, stores them encrypted in
   the Windows credential store, and starts syncing.

Novamail requests `https://mail.google.com/` plus `openid email profile`. Refresh
tokens are renewed silently; if Google revokes access you are asked to sign in
again rather than being shown an error loop.

### Option B — app password

1. Enable 2-step verification: <https://myaccount.google.com/security>
2. Create an app password: <https://myaccount.google.com/apppasswords>
   (choose *Mail* / *Windows computer*). Copy the 16-character code.
3. In the wizard choose **Gmail**, then **Use an app password**, and paste it.
4. Servers are filled in automatically:
   - IMAP `imap.gmail.com:993`, SSL/TLS
   - SMTP `smtp.gmail.com:465`, SSL/TLS (or `587` with STARTTLS)

**Notes**

- Gmail's "All Mail" is exposed as the folder `[Gmail]/All Mail`; Novamail maps
  it to *Archive*.
- Gmail applies its own server-side filters before Novamail sees anything.
  Novamail rules run on top of that.
- Google may require you to re-consent after a password change or 6 months of
  inactivity.

---

## Microsoft 365 (work / school accounts)

Requires OAuth. Many organisations disable IMAP for their tenant — if the wizard
fails with `AUTHENTICATIONFAILED` or "IMAP access is disabled", ask your IT
administrator; Novamail cannot work around a tenant policy.

1. Choose **Microsoft 365**, enter your work address.
2. Click **Continue with Microsoft**. Sign in in the browser. Consent for
   *IMAP.AccessAsUser.All*, *SMTP.Send*, *offline_access* is requested.
3. If your organisation requires admin approval you will see
   *"Need admin approval"* — send that screen to IT.
4. Servers, filled in automatically:
   - IMAP `outlook.office365.com:993`, SSL/TLS
   - SMTP `smtp.office365.com:587`, STARTTLS

**Troubleshooting**

| Error | Meaning |
|---|---|
| `IMAP access is disabled for this mailbox` | tenant policy; needs an administrator |
| `AADSTS65001` / consent required | admin consent not granted |
| `AUTHENTICATE failed` | wrong tenant, or basic auth blocked (it is, by default) |

> Microsoft has retired basic authentication for Exchange Online. A username and
> password will not work for Microsoft 365 no matter what any guide says.

---

## Outlook.com / Hotmail / Live

1. Choose **Outlook.com**, enter your address.
2. Sign in through the browser when prompted (OAuth).
3. Servers:
   - IMAP `outlook.office365.com:993`, SSL/TLS
   - SMTP `smtp-mail.outlook.com:587`, STARTTLS

Personal Microsoft accounts support app passwords only when 2-step verification
is on; OAuth is simpler and is what the wizard offers by default.

---

## iCloud

1. Turn on **app-specific passwords** at <https://account.apple.com> →
   *Sign-In and Security → App-Specific Passwords*.
2. Create one labelled "Novamail" and copy it.
3. Choose **iCloud** in the wizard; the password step expects the app password.
4. Servers:
   - IMAP `imap.mail.me.com:993`, SSL/TLS — username is your iCloud address
     (`you@icloud.com`), not your Apple ID alias
   - SMTP `smtp.mail.me.com:587`, STARTTLS

iCloud requires your Apple ID to have two-factor authentication enabled before
app passwords exist at all.

---

## Yahoo

1. Create an app password: <https://login.yahoo.com/account/security>
   → *Generate app password*.
2. Choose **Yahoo** in the wizard.
3. Servers:
   - IMAP `imap.mail.yahoo.com:993`, SSL/TLS
   - SMTP `smtp.mail.yahoo.com:465`, SSL/TLS

---

## Any other provider (generic IMAP/SMTP)

Choose **Other / IMAP** and fill in the four fields. If the domain is in
Novamail's autoconfiguration table — or publishes an
`autoconfig.<domain>` / `_imaps._tcp` SRV record — the wizard pre-fills them and
tests the connection before you save.

Typical values:

| Provider | IMAP | SMTP |
|---|---|---|
| Fastmail | `imap.fastmail.com:993` SSL | `smtp.fastmail.com:465` SSL |
| Zoho | `imap.zoho.com:993` SSL | `smtp.zoho.com:465` SSL |
| Proton Mail (Bridge) | `127.0.0.1:1143` STARTTLS | `127.0.0.1:1025` STARTTLS |
| Dovecot / self-hosted | `mail.example.com:993` SSL | `mail.example.com:587` STARTTLS |
| Exchange (IMAP enabled) | `mail.example.com:993` SSL | `mail.example.com:587` STARTTLS |

**Always review the server fields.** Autoconfiguration is a guess based on the
domain; a wrong `smtp.` host means mail silently fails to send.

### Port reference

| Port | Security | When to use |
|---|---|---|
| 993 | implicit TLS | IMAP, standard |
| 143 | STARTTLS | IMAP, only if 993 is blocked |
| 465 | implicit TLS | SMTP, standard |
| 587 | STARTTLS | SMTP submission |
| 25 | STARTTLS | server-to-server relay; most providers block it for clients |

Novamail requires TLS 1.2 or newer and validates certificates. It will not
connect to a server with an invalid certificate — there is no "ignore certificate
errors" switch on purpose.

---

## Adding more than one account

Repeat the wizard. Accounts are colour-coded in the sidebar, and the unified
inbox merges them by date. Each account keeps its own signature, rules and sync
settings. Use **Settings → Accounts** to rename, recolour, reorder or remove one.
Removing an account deletes its locally cached mail and its stored credentials;
mail on the server is untouched.

---

## If sign-in fails

1. Confirm you used an **app password**, not your account password (Gmail,
   iCloud, Yahoo) or OAuth (Microsoft 365).
2. Confirm IMAP is enabled for the account — many providers disable it by
   default, and some work tenants disable it entirely.
3. Check the server and port: `993` for IMAP is implicit TLS, `143` is not.
4. Look at **Settings → About → Diagnostics** for the exact IMAP/SMTP response.
   Passwords are redacted from all logs, so it is safe to share the log excerpt.
5. A corporate proxy or VPN that inspects TLS will break certificate validation.
   Novamail reports this as a TLS error rather than silently continuing.
