# Markdown and LaTeX editor

A browser-based editor for Markdown with live LaTeX rendering through KaTeX. Write on the left, read on the right. No build step and no server-side code: open the page and type.

## Features

- Three view modes — editor, split, preview — with a draggable divider
- Two-way scroll sync between editor and preview
- Math: inline `$x$` / `\(x\)`, block `$$...$$`, and LaTeX environments (`\begin{align}`)
- Markdown extras: tables, task lists, strikethrough, fenced code with Prism highlighting
- Formatting toolbar with shortcuts: Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+S, Ctrl+O
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
| `css/` | `tokens` (design tokens + fonts), `base`, `app` (header/toolbar/status), `workspace` (panes + divider), `markdown` (rendered content), `export` (paper + print) |
| `js/` | `core` (namespace + elements), `svg` (icon library), `utils`, `math`, `render`, `documents` (storage), `export`, `editor`, `layout`, `app` (boot) |
| `assets/fonts/` | Inter and Bebas Neue as self-hosted woff2, with their SIL Open Font License files |
| `vendor/katex/` | Self-hosted KaTeX CSS and its woff2 math fonts |
| `assets/favicon.svg` | App mark |

## Libraries

Loaded from CDN: marked 12.0.2, DOMPurify 3.1.6, KaTeX 0.16.11 (JavaScript only — its CSS and fonts are local), Prism 1.29.0 with autoloader, html2pdf 0.10.2.

## Design notes

- Bebas Neue for display, Inter for body and UI, both self-hosted
- One accent color (amber), dark-first, all styling from tokens in `css/tokens.css`
- KaTeX fonts self-hosted in `vendor/katex/` (20 woff2 files)
- The `unslop-check` script reports no findings at P0, P1, or P2
