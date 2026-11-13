# Markdown and LaTeX editor

A browser-based editor for Markdown with live LaTeX rendering through KaTeX. Write on the left, read on the right. No build step and no server-side code: open the page and type.

This is a personal project, shared in case it happens to be useful to someone else. If it works for you, that is good enough.

## Features

- Three view modes — editor, split, preview — with a draggable divider
- Chrome-style document tabs: several Markdown files open at once, `+` adds one, `×` closes (a tab with text asks first), and each tab keeps its own text, name, caret, and scroll position; the strip scrolls sideways with the wheel (shift-wheel stays native) and fades the edge that still has hidden tabs
- The first `# Heading` names the file while it still carries a generated name; renaming the tab by hand keeps your name
- Two-way scroll sync between editor and preview
- Math: inline `$x$` / `\(x\)`, block `$$...$$`, and LaTeX environments (`\begin{align}`); align-family rows line up at their first `=` automatically — no `&` to type — and `\vspace{2em}` adds real space between lines
- Markdown extras: tables, task lists, strikethrough, fenced code with Prism highlighting
- Single-row formatting toolbar that never wraps: a joined `B` `I` `S` `</>` segment plus `H1 ▾`, `Lists ▾`, `Insert ▾`, and `Math ▾` dropdowns — the heading trigger follows the caret (H1–H4 or P), and Math carries equation and `\frac`/`\sum`/matrix templates
- Shortcuts: Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+S, Ctrl+O, Ctrl+F (find), Ctrl+H (find and replace), Ctrl+Alt+T (new tab), Ctrl+Alt+W (close tab), Ctrl+Tab / Ctrl+Shift+Tab (cycle tabs)
- Find and replace in the editor: match count, match case, Enter / Shift+Enter to step through results, Esc to close
- Dark and light themes, autosave to browser storage
- Export: `.md` download, standalone HTML, Word `.docx` with native editable equations, PDF through the browser's print engine (choose Save as PDF), print
- Paper sizes for PDF and DOCX: A4, Letter, Folio / Long, Legal
- Original SVG icon set with a responsive header: text labels on wide screens, icon-only at 800px and below, and an overflow menu for Download, Export HTML, Export .docx, Print, and the paper size

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
| `js/` | `core` (namespace + elements), `svg` (icon library), `utils`, `math`, `render`, `documents` (tab strip + storage), `export`, `docx` (Word export), `editor`, `find`, `layout`, `app` (boot) |
| `assets/fonts/` | Inter and Bebas Neue as self-hosted woff2, with their SIL Open Font License files |
| `vendor/katex/` | Self-hosted KaTeX CSS and its woff2 math fonts |
| `assets/favicon.svg` | App mark |

## Libraries

Everything is vendored locally — the app is fully offline, with one deliberate exception: the Google Sans `@import` for the quote icon.

| Library | Version | Where |
|---|---|---|
| marked | 12.0.2 | `vendor/marked/` |
| DOMPurify | 3.1.6 | `vendor/dompurify/` |
| KaTeX (JS) | 0.16.11 | `vendor/katex/` (CSS and woff2 fonts too) |
| Prism + autoloader + 25 components | 1.29.0 | `vendor/prism/` |
| docx (Word export) | 9.0.2 | `vendor/word/` |
| Temml (LaTeX → MathML) | 0.10.29 | `vendor/word/` |
| mathml2omml (MathML → OMML) | 0.5.0 | `vendor/word/` |

PDF export uses the browser's native vector print engine (`window.print()` → Save as PDF): selectable text and web-font math, no canvas and no rasterization. DOCX export parses the raw Markdown/LaTeX source and converts every expression to native Word OMML equations through Temml and mathml2omml — equations stay double-click editable, never images.

## Design notes

- Bebas Neue for display, Inter for body and UI, both self-hosted
- One accent color (amber), dark-first, all styling from tokens in `css/tokens.css`
- Tables wrap at the measure; when content still overflows, only the horizontal scrollbar bar is hidden — scrolling still works. Code blocks and display math follow the same rule, and the preview pane itself can no longer draw a bar
- The header groups by workflow (document → workspace → output) with hairline dividers; text labels on wide screens, icon-only at 800px and below
- Motion is state-change only (no page-load intro): tabs grow in and collapse out, panes crossfade on view/tab switches, menus exit 20% faster than they enter, themes crossfade with the sun/moon swap, notices fade in and out — token-timed (120/150/200ms) and fully disabled under `prefers-reduced-motion`
- KaTeX fonts self-hosted in `vendor/katex/` (20 woff2 files)
- The `unslop-check` script reports no findings at P0, P1, or P2
