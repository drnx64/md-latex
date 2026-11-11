# Markdown and LaTeX editor

A browser-based editor for Markdown with live LaTeX rendering through KaTeX. Write on the left, read on the right. No build step and no server-side code: open the page and type.

## Features

- Three view modes — editor, split, preview — with a draggable divider
- Chrome-style document tabs: several Markdown files open at once, `+` adds one, `×` closes (a tab with text asks first), and each tab keeps its own text, name, caret, and scroll position
- Two-way scroll sync between editor and preview
- Math: inline `$x$` / `\(x\)`, block `$$...$$`, and LaTeX environments (`\begin{align}`)
- Markdown extras: tables, task lists, strikethrough, fenced code with Prism highlighting
- Single-row formatting toolbar that never wraps: a joined `B` `I` `S` `</>` segment plus `H1 ▾`, `Lists ▾`, `Insert ▾`, and `Math ▾` dropdowns — the heading trigger follows the caret (H1–H4 or P), and Math carries equation and `\frac`/`\sum`/matrix templates
- Shortcuts: Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+S, Ctrl+O, Ctrl+Alt+T (new tab), Ctrl+Alt+W (close tab), Ctrl+Tab / Ctrl+Shift+Tab (cycle tabs)
- Dark and light themes, autosave to browser storage
- Export: `.md` download, standalone HTML, PDF (html2pdf), print
- Original SVG icon set with a responsive header: text labels on wide screens, icon-only at 800px and below, and an overflow menu for Download, Export HTML, and Print

## Running it

Open `index.html` directly, or serve the folder:

```text
npx serve .
python -m http.server
```

Everything works from `file://` except **Export HTML**: it reads the `css/` files, which browsers block on `file://`. Serve over `http://` for that one action; otherwise it falls back to the built-in stylesheet rules.

## Structure

| Path | Contents |
|---|---|
| `index.html` | Markup and script/style wiring |
| `css/` | `tokens` (design tokens + fonts), `base`, `app` (header/tabs/toolbar/status), `workspace` (panes + divider), `markdown` (rendered content), `export` (paper + print) |
| `js/` | `core` (namespace + elements), `svg` (icon library), `utils`, `math`, `render`, `documents` (tab strip + storage), `export`, `editor`, `layout`, `app` (boot) |
| `assets/fonts/` | Inter and Bebas Neue as self-hosted woff2, with their SIL Open Font License files |
| `vendor/katex/` | Self-hosted KaTeX CSS and its woff2 math fonts |
| `assets/favicon.svg` | App mark |

## Libraries

Loaded from CDN: marked 12.0.2, DOMPurify 3.1.6, KaTeX 0.16.11 (JavaScript only — its CSS and fonts are local), Prism 1.29.0 with autoloader, html2pdf 0.10.2.

## Design notes

- Bebas Neue for display, Inter for body and UI, both self-hosted
- One accent color (amber), dark-first, all styling from tokens in `css/tokens.css`
- Tables wrap at the measure; when content still overflows, only the horizontal scrollbar bar is hidden — scrolling still works. Code blocks and display math follow the same rule, and the preview pane itself can no longer draw a bar
- The header groups by workflow (document → workspace → output) with hairline dividers; text labels on wide screens, icon-only at 800px and below
- Motion is state-change only (no page-load intro): tabs grow in and collapse out, panes crossfade on view/tab switches, menus exit 20% faster than they enter, themes crossfade with the sun/moon swap, notices fade in and out — token-timed (120/150/200ms) and fully disabled under `prefers-reduced-motion`
- KaTeX fonts self-hosted in `vendor/katex/` (20 woff2 files)
- The `unslop-check` script reports no findings at P0, P1, or P2
