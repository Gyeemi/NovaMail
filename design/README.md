# design/

Input folder for Figma work. See `docs/DESIGN-WORKFLOW.md` for the full loop.

| Path | What goes here |
|---|---|
| `tokens.json` | Token export from Figma (`npm run design:tokens` turns it into CSS variables) |
| `tokens.example.json` | Reference for the expected shape — copy it to `tokens.json` to start |
| `assets/` | SVGs, 2x PNG screenshots, icons |

Arena cannot connect to Figma, so these are committed files rather than a live
link. That is also an advantage: the design source is versioned next to the code
that implements it.
