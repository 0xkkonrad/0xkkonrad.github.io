# Visuals & Typography in PaperMod — Reference

A map of how the PaperMod theme handles styling on this site, so future customization (fonts, colors, spacing) is grounded in the actual system rather than guesswork.

The project currently has **no `assets/` directory at the repo root**, meaning no overrides are in place — the theme runs entirely from defaults.

---

## 1. CSS architecture & build pipeline

All theme CSS lives under [themes/PaperMod/assets/css/](themes/PaperMod/assets/css/):

```
core/        theme-vars.css, reset.css, zmedia.css, license.css
common/      main, header, footer, post-entry, post-single, md-content, archive, search, ...
includes/    chroma-styles.css, chroma-mod.css   (syntax highlighting)
extended/    blank.css                           (override hook — see §6)
```

The bundle is assembled in [themes/PaperMod/layouts/partials/head.html](themes/PaperMod/layouts/partials/head.html#L47-L63) (lines 47–63) via Hugo Pipes. Order matters:

1. `theme-vars.css` (tokens) → 2. `reset.css` → 3. all of `common/*.css` → 4. chroma → 5. `zmedia.css` (media queries last)
   …concatenated + minified into `core.css`.
6. Everything in `css/extended/*.css` → concatenated into `extended.css`.
7. Final stylesheet = `license.css + core.css + extended.css`, fingerprinted, served as one `<link>`.

Because **extended is appended after core**, your overrides win on equal-specificity selectors without `!important`.

---

## 2. Design tokens (CSS variables)

All tokens live in [themes/PaperMod/assets/css/core/theme-vars.css](themes/PaperMod/assets/css/core/theme-vars.css). Two blocks: `:root` (light) and `:root[data-theme="dark"]` (dark overrides).

**Layout tokens** (light & dark identical):

- `--gap: 24px` — primary gutter; reduced to 14px under 768px in `zmedia.css`
- `--content-gap: 20px` — vertical rhythm between paragraphs/blocks
- `--nav-width: 1024px` — header max-width
- `--main-width: 720px` — content max-width (the readable column)
- `--header-height: 60px`, `--footer-height: 60px`
- `--radius: 8px` — global border-radius

**Color tokens** (light → dark):

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--theme` | white | `rgb(29,30,32)` | page background |
| `--entry` | white | `rgb(46,46,51)` | card/entry surfaces |
| `--primary` | `rgb(30,30,30)` | `rgb(218,218,219)` | body & headings text |
| `--secondary` | `rgb(108,108,108)` | `rgb(155,156,157)` | metadata, muted text |
| `--tertiary` | `rgb(214,214,214)` | `rgb(65,66,68)` | dividers, hr |
| `--content` | `rgb(31,31,31)` | `rgb(196,196,197)` | rich-text accents (blockquote bar) |
| `--code-block-bg` | `rgb(28,29,33)` | `rgb(46,46,51)` | `<pre>` background |
| `--code-bg` | `rgb(245,245,245)` | `rgb(55,56,62)` | inline `<code>` |
| `--border` | `rgb(238,238,238)` | `rgb(51,51,51)` | tables |

There is no separate accent/link color token — links inherit `--primary` plus an underline (see §3).

---

## 3. Typography

**Font stack** — defined once on `body` in [themes/PaperMod/assets/css/core/reset.css](themes/PaperMod/assets/css/core/reset.css) (system stack, no web fonts loaded):

```
-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu,
Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif
```

Body is `18px / 1.6`, color `var(--primary)`.

**Heading scale** — [themes/PaperMod/assets/css/common/md-content.css](themes/PaperMod/assets/css/common/md-content.css#L1-L32) (lines 1–32, applies to rendered markdown):

| Tag | Size | Margin (top / bottom) |
|---|---|---|
| h1 | 40px | 40 / 32 |
| h2 | 32px | 32 / 24 |
| h3 | 24px | 24 / 16 |
| h4 | 16px | 24 / 16 |
| h5 | 14px | 24 / 16 |
| h6 | 12px | 24 / 16 |

All headings keep the body font; weight comes from the browser default (`bold`). No fluid/responsive type scaling.

**Other prose elements** (same file):

- Links: `text-decoration: underline; text-underline-offset: 0.3rem`
- Blockquote: `border-inline-start: 0.3rem solid var(--content); padding-inline-start: 1rem`
- Lists: `padding-inline-start: 1.25rem; li margin-top: 0.3rem`
- `hr`: 2px, `var(--tertiary)`
- Inline `code`: `0.78em`, `var(--code-bg)` background, `0.2rem` radius
- `pre`: `var(--code-block-bg)`, `--radius` corners, hardcoded `rgb(213,213,214)` text

---

## 4. Layout & responsive behavior

Main column ([themes/PaperMod/assets/css/common/main.css](themes/PaperMod/assets/css/common/main.css#L1-L7), lines 1–7):

```css
.main {
  max-width: calc(var(--main-width) + var(--gap) * 2);  /* 720 + 48 = 768px */
  margin: auto;
  padding: var(--gap);
}
```

Breakpoints in [themes/PaperMod/assets/css/core/zmedia.css](themes/PaperMod/assets/css/core/zmedia.css):

- `≤ 768px` — `--gap` shrinks to 14px (most spacing tightens automatically because everything keys off `--gap`); profile images scale to 0.85×
- `≤ 900px` — footer link adjustments
- `≤ 340px` — share button reflow
- `prefers-reduced-motion` — disables transforms

---

## 5. Light/dark theme toggle

- **Mechanism:** a `data-theme` attribute on `<html>` toggled between `"light"` and `"dark"`. CSS variables re-bind, the page recolors instantly.
- **UI:** sun/moon button rendered in [themes/PaperMod/layouts/partials/header.html](themes/PaperMod/layouts/partials/header.html); the inactive icon hidden via `[data-theme="dark"] .moon { display:none }` in `common/header.css`.
- **JS:** click handler in [themes/PaperMod/layouts/partials/footer.html](themes/PaperMod/layouts/partials/footer.html) — flips `html.dataset.theme` and persists to `localStorage["pref-theme"]`.
- **Init:** inline script in `head.html` reads `localStorage["pref-theme"]` first; if absent and `params.defaultTheme = "auto"` (current setting in [hugo.toml](hugo.toml)), falls back to `prefers-color-scheme`.
- **No-JS fallback:** a `<noscript>` block in `head.html` re-applies dark variables under `@media (prefers-color-scheme: dark)`.

Configurable via `hugo.toml` `params.defaultTheme` (`light` | `dark` | `auto`) and `disableThemeToggle`.

---

## 6. The override path

PaperMod's intended customization hook is **`assets/css/extended/`** mirrored at the project root. Hugo's union filesystem makes any project-level file shadow the theme's, and `resources.Match "css/extended/*.css"` picks up everything in that folder.

This directory does not yet exist in the repo. To customize, create:

```
0xkkonrad.github.io-1/
└── assets/
    └── css/
        └── extended/
            └── custom.css     ← any name; multiple files allowed
```

Inside, the canonical pattern is to **override tokens, not selectors** — e.g.:

```css
:root {
  --main-width: 640px;        /* narrower column */
  --primary: #111;
}
:root[data-theme="dark"] {
  --primary: #eaeaea;
}
body { font-family: 'Inter', system-ui, sans-serif; }
```

If loading a web font, add the `<link>` via a custom `layouts/partials/extend_head.html` (PaperMod looks for that partial automatically) so it preconnects/preloads correctly rather than `@import` inside CSS.

---

## Verifying against the running site

1. `hugo server` from the project root.
2. DevTools → Elements → inspect `<html>`: confirm the `data-theme` attribute toggles when clicking the sun/moon.
3. DevTools → Computed: any element should show CSS variables resolving to the values in §2.
4. View the bundled stylesheet `<link>` in the page source — file name pattern `stylesheet.<hash>.css`. Searching it for `--main-width` should return one definition (light) plus the dark override.

---

## Critical files (for future customization)

- [hugo.toml](hugo.toml) — `params.defaultTheme`, `params.assets.*`
- [themes/PaperMod/assets/css/core/theme-vars.css](themes/PaperMod/assets/css/core/theme-vars.css) — all design tokens
- [themes/PaperMod/assets/css/core/reset.css](themes/PaperMod/assets/css/core/reset.css) — body font stack, base size
- [themes/PaperMod/assets/css/common/md-content.css](themes/PaperMod/assets/css/common/md-content.css) — prose typography
- [themes/PaperMod/assets/css/core/zmedia.css](themes/PaperMod/assets/css/core/zmedia.css) — breakpoints
- [themes/PaperMod/layouts/partials/head.html](themes/PaperMod/layouts/partials/head.html) — asset bundling, theme init
- (to create) `assets/css/extended/custom.css` — your override sheet
- (optional) `layouts/partials/extend_head.html` — to inject web font links
