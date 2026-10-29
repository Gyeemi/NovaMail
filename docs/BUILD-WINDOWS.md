# Building the Novamail Windows installer

Target artefact: **`release/Novamail-Setup-x64.exe`** (NSIS, per-user, x64).

There are three supported ways to produce it. Pick the one that matches what
you have available.

| # | Where | Needs | Produces |
|---|-------|-------|----------|
| 1 | GitHub Actions (Windows runner) | a push to this repo | installer attached to the workflow run + a draft Release |
| 2 | Your own Windows 10/11 PC | Node 22, ~2 GB disk | installer + portable zip |
| 3 | A Linux machine | Node 22, **wine**, ~3 GB disk | installer (untested on this project) |

> **Why you cannot just download an `.exe` from this repository:**
> an installer is a compiled binary, not source. Building one requires running
> `electron-builder` against a Windows-targeted Electron runtime, and the
> development sandbox this project was written in has no internet access to
> GitHub release assets and no wine, so it cannot assemble the file. Everything
> needed to build it *is* committed — configuration, icons, licence, tests and
> the CI workflow below.

---

## Option 1 - GitHub Actions (recommended, nothing to install)

A workflow is committed at `.github/workflows/build-windows.yml`.

> **GitHub quirk worth knowing:** the **Run workflow** button only appears once
> the workflow file exists on the **default branch** (`main`). A workflow that
> only exists on a feature branch can still be triggered by a tag or branch
> push — that is how the existing `v1.0.0` build was produced — but it will not
> show up in the Actions sidebar yet. Merge the pull request first if you want
> the button.

### Already built: v1.0.0

The first installer was built from tag `v1.0.0`:

- Run: <https://github.com/Gyeemi/NovaMail/actions/runs/40840519047>
- Artifact `Novamail-Setup-x64` (141 MB, a zip containing
  `Novamail-Setup-x64.exe`): open the run page and download it from the
  **Artifacts** section at the bottom.
- A **draft** release named `Novamail v1.0.0` holds the same `.exe`. Open it from
  **Releases → Drafts** and click **Publish release** to make a permanent public
  download link — but read `docs/SECURITY.md` first: the binary is unsigned.

### Building again

**By tag** (works from any branch, also creates a draft release):

```bash
git tag v1.0.1
git push origin v1.0.1
```

**By button** (after the workflow is on `main`):

1. **Actions → Build Windows installer → Run workflow**
2. Choose the branch, click **Run workflow**
3. When the job turns green (~5 minutes), open it and download the
   **`Novamail-Setup-x64`** artifact.

**From the command line:**

```bash
gh workflow run build-windows.yml --ref arena/3f3e0882-novamail
gh run watch
```

What the workflow does, in order:

```
npm ci                     # exact dependency tree from package-lock.json
npm run typecheck          # tsc, both projects, must be clean
npx vitest run             # 54 tests
npx electron-vite build    # out/main, out/preload, out/renderer
npx electron-builder --win nsis --x64 --publish never
```

It fails loudly if `Novamail-Setup-x64.exe` is not produced.

---

## Option 2 - Build it on Windows yourself

Requirements:

- Windows 10 or 11 (x64)
- Node.js 22.12 or newer — <https://nodejs.org>
- Git for Windows
- ~2 GB free disk

```powershell
git clone https://github.com/Gyeemi/NovaMail.git
cd NovaMail
git checkout arena/3f3e0882-novamail

npm ci
npm run verify      # pre-flight: bundles, icons, config, native binaries
npm run dist:win    # typecheck + build + NSIS package
```

The installer appears at:

```
release\Novamail-Setup-x64.exe
```

For an unpacked build you can run without installing (useful for testing):

```powershell
npm run dist:dir
.\release\win-unpacked\Novamail.exe
```

For a single-file portable build instead of an installer:

```powershell
npm run dist:win:portable   # release\Novamail-Portable-x64.exe
```

### Notes for Windows builders

- **No Visual Studio / C++ toolchain is required.** `better-sqlite3` 13 ships
  N-API prebuilds for `win32-x64`, so `npmRebuild` is set to `false` in
  `electron-builder.yml`. Nothing is compiled during packaging.
- **The installer is unsigned.** There is no code-signing certificate for this
  project, so Windows SmartScreen shows *"Windows protected your PC"* on first
  run: click **More info → Run anyway**. See `docs/SECURITY.md`.
- The build takes about 2–4 minutes on a modern laptop; most of it is copying
  the Electron runtime.

---

## Option 3 - Build it on Linux

`electron-builder` can cross-build a Windows installer from Linux, but it shells
out to `wine` to stamp the executable's icon and version metadata.

```bash
# Debian / Ubuntu
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install -y wine wine32 wine64 nsis

npm ci
npm run verify
npm run dist:win
```

If wine is unavailable, disable executable editing to get a working (but
icon-less in Explorer) installer:

```yaml
# electron-builder.yml
win:
  signAndEditExecutable: false
```

This path is provided for completeness and is **not verified** for this project:
wine versions differ wildly and NSIS on Linux produces slightly different
installer internals. Option 1 or 2 is preferred for anything you hand to a user.

---

## Verifying the result

Once you have `Novamail-Setup-x64.exe`:

1. **Signature / size** — right-click → *Properties* → *Digital Signatures* is
   empty (expected, unsigned). Size is roughly 90–110 MB.
2. **Install** — run it, accept the per-user install (no admin prompt by
   default), choose a folder if you want.
3. **Launch** — Start menu → *Novamail*, or the desktop shortcut.
4. **Data location** — after first launch, `%APPDATA%\Novamail\` should contain
   `novamail.db`, `settings.json` and `logs\`. Nothing is written under
   `C:\Users\<you>\AppData\Local\Programs\Novamail\`.
5. **Add an account** — the wizard opens automatically. Real IMAP/SMTP only;
   there is no test-data mode in the packaged app.
6. **Upgrade test** — change a setting, run a newer installer over the top, and
   confirm the setting is still there (this is why user data lives outside the
   install directory).
7. **Uninstall** — *Settings → Apps → Novamail → Uninstall*. The installer
   leaves `%APPDATA%\Novamail` in place on purpose so reinstalling does not lose
   mail; delete that folder manually if you want a clean slate.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `unable to verify the first certificate` from electron-builder | corporate proxy or sandbox TLS interception | build on the Windows runner (Option 1) |
| `cannot execute rcedit` / `wine: command not found` | building for Windows on Linux without wine | install wine, or set `signAndEditExecutable: false` |
| `resource busy or locked` on `app.asar` | a previous `Novamail.exe` is still running | close the app, delete `release\`, rebuild |
| `better_sqlite3.node` not found at runtime | packaging ran with a pruned `node_modules` | `npm ci` then rebuild; check `asarUnpack` in `electron-builder.yml` |
| `EPERM` during install | installing into a protected folder | use the default per-user location |
| SmartScreen blocks the installer | unsigned binary | *More info → Run anyway* (or sign it — see `docs/SECURITY.md`) |
