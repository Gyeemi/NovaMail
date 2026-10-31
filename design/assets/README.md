# Design assets

Drop Figma exports here, keeping the names Figma gives them.

- `logo.svg`, `illustrations/*.svg` — vector, preferred; I can inline them as React components
- `screens/*.png` — 2x PNG reference shots of each frame (for layout comparison)
- `icons/*.svg` — single-path icons go into `src/renderer/src/components/icons.tsx`

Nothing in this folder is bundled into the app automatically. SVGs are imported
by the components that need them, so unused files never ship in the installer.
