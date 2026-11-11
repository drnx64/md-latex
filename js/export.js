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

    function buildPaperElement() {
        const paper = document.createElement("div");
        paper.className = "paper";

        const body = document.createElement("div");
        body.className = "markdown-body";
        body.innerHTML = elements.preview.innerHTML;

        // The hidden MathML copy renders as duplicate text in the canvas capture.
        body.querySelectorAll(".katex-mathml").forEach((mathml) => mathml.remove());

        paper.appendChild(body);
        return paper;
    }

    async function exportPdf() {
        if (!window.html2pdf) {
            App.showNotice("The PDF library did not load. Check your connection and reload.", true);
            return;
        }

        App.renderPreview();
        elements.exportPdfButton.disabled = true;
        elements.exportPdfButton.setAttribute("aria-busy", "true");

        const paper = buildPaperElement();
        document.body.appendChild(paper);

        try {
            if (document.fonts?.ready) await document.fonts.ready;

            await window.html2pdf().set({
                margin: [14, 14, 16, 14],
                filename: `${App.getBaseFileName()}.pdf`,
                image: { type: "jpeg", quality: 0.98 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    logging: false,
                    scrollX: 0,
                    scrollY: 0,
                    backgroundColor: getComputedStyle(paper).backgroundColor,
                },
                jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
                pagebreak: {
                    mode: ["css", "legacy"],
                    avoid: ["pre", "table", "tr", "blockquote", "img", ".katex-display", "h1", "h2", "h3", "h4"],
                },
            }).from(paper).save();

            App.showNotice("PDF exported.");
        } catch (error) {
            App.showNotice("PDF export failed. Try Print and save as PDF instead.", true);
        } finally {
            paper.remove();
            elements.exportPdfButton.disabled = false;
            elements.exportPdfButton.removeAttribute("aria-busy");
        }
    }

    function printDocument() {
        App.renderPreview();
        window.print();
    }

    // Print always uses the light theme so paper output stays readable.
    function handleBeforePrint() {
        document.documentElement.dataset.printRestoreTheme = document.documentElement.dataset.theme;
        document.documentElement.dataset.theme = "light";
    }

    function handleAfterPrint() {
        document.documentElement.dataset.theme = document.documentElement.dataset.printRestoreTheme || "dark";
        delete document.documentElement.dataset.printRestoreTheme;
    }

    Object.assign(App, {
        exportHtml,
        exportPdf,
        printDocument,
        handleBeforePrint,
        handleAfterPrint,
    });
})();
