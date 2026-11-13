(() => {
    "use strict";

    const { elements } = App;

    const APP_STYLESHEET_PATHS = [
        "css/tokens.css",
        "css/base.css",
        "css/app.css",
        "css/workspace.css",
        "css/markdown.css",
        "css/export.css",
    ];

    // Paper formats in mm. The print engine reads these from the injected
    // @page rule (see updatePageRule) and the DOCX section properties use the
    // same map, so paper output stays consistent across both exports.
    const PAGE_SIZES = Object.freeze({
        a4: { label: "A4", widthMm: 210, heightMm: 297 },
        letter: { label: "Letter (8.5 × 11)", widthMm: 215.9, heightMm: 279.4 },
        folio: { label: "Folio / Long (8.5 × 13)", widthMm: 215.9, heightMm: 330.2 },
        legal: { label: "Legal (8.5 × 14)", widthMm: 215.9, heightMm: 355.6 },
    });
    const DEFAULT_PAPER_SIZE = "a4";

    // Page margin in mm, shared by print-to-PDF (@page) and DOCX sections.
    const PAGE_MARGIN_MM = 20;

    function getPaperSizeKey() {
        const saved = App.readStorage(App.STORAGE_KEYS.paperSize);
        return PAGE_SIZES[saved] ? saved : DEFAULT_PAPER_SIZE;
    }

    function getPaperSize() {
        return PAGE_SIZES[getPaperSizeKey()];
    }

    // The browser's native print engine is the PDF pipeline now: vector text,
    // selectable math, no canvas. It sizes pages from @page, so inject one
    // rule from the selected paper size (export.css holds the A4 baseline).
    function updatePageRule() {
        const size = getPaperSize();
        let style = document.getElementById("pageRuleStyle");
        if (!style) {
            style = document.createElement("style");
            style.id = "pageRuleStyle";
            document.head.appendChild(style);
        }
        style.textContent = `@page { size: ${size.widthMm}mm ${size.heightMm}mm; margin: ${PAGE_MARGIN_MM}mm; }`;
    }

    updatePageRule();

    // file:// pages cannot fetch local files, so fall back to the loaded rules.
    async function loadAppStyles() {
        try {
            const texts = await Promise.all(APP_STYLESHEET_PATHS.map(async (path) => {
                const response = await fetch(path);
                if (!response.ok) throw new Error(path);
                return response.text();
            }));
            return texts.join("\n");
        } catch (error) {
            const rules = [];
            for (const styleSheet of document.styleSheets) {
                try {
                    for (const rule of styleSheet.cssRules) rules.push(rule.cssText);
                } catch (crossOriginError) {
                    // The KaTeX CDN sheet is cross-origin; skip it.
                }
            }
            return rules.length > 0 ? rules.join("\n") : null;
        }
    }

    async function buildStandaloneHtml() {
        const katexStylesheet = document.querySelector('link[href*="katex"]');
        const katexHref = katexStylesheet ? katexStylesheet.href : "";
        const appStyles = await loadAppStyles();
        if (appStyles === null) return null;

        // Font URLs are relative to css/, so point them at this app for the exported file.
        const fontBase = new URL("assets/fonts/", document.baseURI).href;
        const inlinedStyles = appStyles.replaceAll("../assets/fonts/", fontBase);

        return [
            "<!doctype html>",
            '<html lang="en" data-theme="light">',
            "<head>",
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            `<title>${App.escapeHtml(App.getDocumentTitle())}</title>`,
            `<link rel="stylesheet" href="${App.escapeHtml(katexHref)}">`,
            `<style>${inlinedStyles}</style>`,
            "</head>",
            '<body class="standalone">',
            `<article class="markdown-body">${elements.preview.innerHTML}</article>`,
            "</body>",
            "</html>",
        ].join("\n");
    }

    async function exportHtml() {
        const html = await buildStandaloneHtml();
        if (html === null) {
            App.showNotice("Could not read the css files. Serve this folder over HTTP to export HTML.", true);
            return;
        }
        const htmlBlob = new Blob([html], { type: "text/html;charset=utf-8" });
        App.downloadBlob(htmlBlob, `${App.getBaseFileName()}.html`);
    }

    // Print paper cannot scroll, so table content that cannot wrap (KaTeX math
    // and images are unbreakable inline boxes) must shrink until the table
    // fits the page width — otherwise auto layout pushes min-content past the
    // margin and the right edge gets clipped.
    // Transitions are disabled while fitting (export.css): a running transition
    // makes getComputedStyle report the old value, so the loop's re-reads
    // would never see the shrink it just applied.
    function fitTablesToPage(root) {
        root.querySelectorAll("table").forEach((table) => {
            for (let pass = 0; pass < 20; pass += 1) {
                const overflow = table.scrollWidth - table.clientWidth;
                if (overflow <= 1) return;
                const unbreakable = table.querySelectorAll(".katex, img");
                if (unbreakable.length === 0) return;
                const factor = table.clientWidth / table.scrollWidth;
                unbreakable.forEach((element) => {
                    if (element.tagName === "IMG") {
                        const width = element.getBoundingClientRect().width;
                        element.style.width = `${Math.max(8, width * factor)}px`;
                        element.style.height = "auto";
                    } else {
                        const size = Number.parseFloat(window.getComputedStyle(element).fontSize);
                        element.style.fontSize = `${Math.max(6, size * factor)}px`;
                    }
                });
            }
        });
    }

    // PDF export = the browser's native vector print engine: selectable text,
    // KaTeX web-font math, zero rasterization. The user picks "Save as PDF"
    // in the print dialog; @page (updatePageRule) sets the paper size.
    function exportPdf() {
        App.showNotice('In the print dialog, choose "Save as PDF" to save the file.');
        printDocument();
    }

    function printDocument() {
        App.renderPreview();
        updatePageRule();
        window.print();
    }

    // Print always uses the light theme so paper output stays readable.
    function handleBeforePrint() {
        document.documentElement.dataset.printRestoreTheme = document.documentElement.dataset.theme;
        document.documentElement.dataset.theme = "light";
        document.body.classList.add("is-print-fitting");
        updatePageRule();
        fitTablesToPage(elements.preview);
    }

    function handleAfterPrint() {
        document.documentElement.dataset.theme = document.documentElement.dataset.printRestoreTheme || "dark";
        delete document.documentElement.dataset.printRestoreTheme;
        document.body.classList.remove("is-print-fitting");
        // Re-rendering drops the inline fit styles the print pass added.
        App.renderPreview();
    }

    Object.assign(App, {
        exportHtml,
        exportPdf,
        printDocument,
        handleBeforePrint,
        handleAfterPrint,
        PAGE_SIZES,
        PAGE_MARGIN_MM,
        getPaperSizeKey,
        updatePageRule,
    });
})();
