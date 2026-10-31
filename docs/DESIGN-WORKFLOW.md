# Working with Figma designs

Arena.ai **cannot connect to Figma.** This document records exactly what was
checked, why it fails, and the workflow that does work — designs travel as files
in this repository instead of over a live connection.

---

## What was tested (and the result)

Checked on this branch, in this environment:

| Check | Command | Result |
|---|---|---|
| Is Figma an available connector? | `list_connector_tools("figma")` | `unsupported` — Arena does not offer a Figma connector |
| Is there a generic MCP connector? | `list_connector_tools("mcp")` | `unsupported` |
| MCP-specific slugs | `list_connector_tools("figma-mcp")`, `("model-context-protocol")` | `unsupported` |
| Does the connector mechanism work at all? | `list_connector_tools("notion")` | `disconnected` — i.e. Arena *does* offer Notion, the user simply has not connected it. This distinguishes "not offered" from "not connected". |
| Can the sandbox reach Figma over the network? | `curl https://api.figma.com`, `https://www.figma.com`, `https://mcp.figma.com` | all fail at TLS connect (`curl` exit 35, `http=000`) |
| Control: is any network available? | `curl https://api.github.com` | `200` |

### The exact limitation

1. **No MCP client surface.** Arena Agent Mode exposes a fixed catalogue of
   connectors. There is no way for a user to add an arbitrary MCP server URL, and
   no UI to run the OAuth flow `https://mcp.figma.com/mcp` requires. Registering
   `https://mcp.figma.com/mcp` is therefore not possible from this session — not a
   permissions problem, a missing capability.
2. **No network path to Figma even without MCP.** The sandbox's egress allow-list
   covers `github.com`, `codeload.github.com`, `api.github.com`,
   `registry.npmjs.org`, `pypi.org` and `files.pythonhosted.org`. All `figma.com`
   hosts are blocked at the TLS layer. So even a hand-written Figma REST client
   with a personal access token (`X-Figma-Token`) could not fetch a file: the
   request cannot leave the sandbox.
3. **Auth cannot be completed here.** Figma's remote MCP uses OAuth 2.1; the
   consent screen must be completed by a signed-in human in a browser. Nothing in
   this environment can complete or store that grant, and I will not ask you to
   paste a Figma access token or password into chat.

Consequence: **steps 2–4 of the request (configure, authenticate, verify by
retrieving a file) cannot be performed, and no claim of a working Figma
connection is made.**

---

## The workflow that works

Figma → exported files → this repository → implemented UI. It is a two-minute
round trip per change and needs no integration.

### 1. Tokens (colours, spacing, radii, type scale)

This is the highest-value path because Novamail's UI is already entirely
token-driven (`src/renderer/src/styles/tokens.css`, `--nm-*` custom properties).

1. In Figma, open **Variables** (Local variables) or the **Tokens Studio** plugin.
2. Export as JSON, in W3C design-token form. If you use Figma's own variable
   export, nest it under `light` and `dark` keys — see
   `design/tokens.example.json` for the shape.
3. Save it as `design/tokens.json` and commit.

```bash
npm run design:tokens     # design/tokens.json -> src/renderer/src/styles/tokens.generated.css
```

4. Add one import to `src/renderer/src/main.tsx`, after the existing token import:

```ts
import './styles/tokens.css'
import './styles/tokens.generated.css'   // <- generated from Figma
```

The converter maps `color.text.muted` to `--nm-text-muted` (the leading `color`
group is implied), emits a `:root` block and a `:root[data-theme='dark']` block,
resolves `{alias}` references, and **rejects any value that could inject CSS**
(`;`, `}`, `url(...)`, `@import`). `npm run verify` fails if the generated file is
out of date, so tokens cannot silently drift.

### 2. Assets (logos, illustrations, icons)

- Export SVG where possible (smaller, themeable, and I can inline it as a React
  component so it can inherit `currentColor`).
- Export PNG at 2× for reference screenshots.
- Drop them in `design/assets/` and commit. Nothing there is bundled
  automatically — only files imported by a component end up in the installer.

### 3. Screens (layout, spacing, hierarchy)

Commit 2× PNGs of the frames you care about to `design/assets/screens/`, or paste
them straight into the chat — screenshots are visible to me directly, which is
usually the fastest way to say "make it look like this".

### 4. Copy and specs

For a single component, Figma's **Dev Mode → Copy as code** (or the Inspect panel)
gives CSS I can paste-adapt. Useful for one-offs; for whole screens, the exported
frame plus a short description works better.

---

## What to send for a UI change

A useful minimum, in one message:

1. The frame as a screenshot or a committed PNG.
2. Which screen it replaces (`Settings → Appearance`, the reading pane, …).
3. Any tokens that changed (or just the JSON).
4. Anything interactive that is not visible in a static frame — hover, empty
   state, keyboard behaviour.

---

## If Arena adds MCP support later

If a Figma connector or a generic "add MCP server" option becomes available, the
integration would be:

1. Connect Figma in Arena's connector settings (OAuth 2.1 consent in the browser).
2. Enable it for the conversation so its tools load.
3. Point it at `https://mcp.figma.com/mcp`, then read a file with the design
   context tool before writing any UI code.

The token converter in this repository stays useful either way: whether the
values arrive over MCP or in a committed JSON file, they still have to become
`--nm-*` custom properties before the app can use them.
