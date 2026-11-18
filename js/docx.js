(() => {
    "use strict";

    // DOCX export parses the RAW Markdown/LaTeX source — never the rendered
    // KaTeX DOM — so the original $...$ / $$...$$ strings survive and every
    // equation lands in Word as native editable OMML (Temml → MathML → OMML),
    // never as a PNG.
    const {
        Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
        Table, TableRow, TableCell, WidthType, BorderStyle, LevelFormat,
        ImportedXmlComponent, ExternalHyperlink, ImageRun, ShadingType,
    } = window.docx || {};

    const { elements } = App;

    const MM_TO_TWIPS = 1440 / 25.4;
    const MAX_IMAGE_WIDTH_PX = 550;
    const CODE_SHADING = { type: "clear", color: "auto", fill: "F4F4F4" };

    function twips(mm) {
        return Math.round(mm * MM_TO_TWIPS);
    }

    // ------------------------------------------------------------- escaping --
    // XML 1.0 permits only #x9 | #xA | #xD | #x20-#xD7FF | #xE000-#xFFFD |
    // #x10000-#x10FFFF. Control characters and lone surrogates are legal
    // Markdown but illegal XML: one of them anywhere in word/document.xml (or
    // docProps/core.xml) makes Word abort with "Word experienced an error
    // trying to open the file… Open the file with the Text Recovery converter".
    const INVALID_XML_CHARS =
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

    function xmlSafe(text) {
        return String(text == null ? "" : text).replace(INVALID_XML_CHARS, "");
    }

    // marked escapes &, <, >, " and ' in text/codespan/escape tokens for its
    // HTML output, so the DOCX exporter receives "$a &lt; b$" instead of
    // "$a < b$". docx escapes every one of those characters again when it
    // serializes <w:t> (verified: TextRun "&amp;" -> w:t "&amp;amp;"), so
    // marked's entities must all be decoded here or Word prints them
    // literally ("&amp;" where the source had "&").
    //
    // Order matters: marked turns a literal "&lt;" in the source into
    // "&amp;lt;". Decoding "&lt;" first would then miss "&amp;lt;", and
    // decoding "&amp;" first would turn the "&amp;lt;" it produces into a
    // real "<". So decode the specific entities first and "&amp;" last —
    // that maps every marked output back to the exact source text.
    function decodeMarkedEntities(text) {
        return String(text == null ? "" : text)
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, "&");
    }

    // ---------------------------------------------------------------- math --
    // raw LaTeX -> MathML (Temml) -> OMML (mathml2omml) -> docx XML node.

    // xml-js wraps a parsed document in a synthetic nameless root, which docx
    // serializes as an illegal <undefined> element that Word refuses. Unwrap
    // it so the real <m:oMath>/<m:oMathPara> component lands in the paragraph.
    function importOmml(omml) {
        const imported = ImportedXmlComponent.fromXmlString(omml);
        if (imported.rootKey !== undefined) return imported;
        if (imported.root.length !== 1 || typeof imported.root[0] !== "object") {
            throw new Error("Unexpected OMML structure");
        }
        return imported.root[0];
    }

    function mathRun(tex, display) {
        const source = xmlSafe(tex);
        try {
            // Same transform as the preview: auto-& and \vspace → strut.
            // throwOnError turns Temml's <span class="temml-error"> fallback
            // markup into a catchable ParseError instead of feeding junk to
            // the OMML converter.
            const mathml = window.temml.renderToString(App.prepareMath(source), {
                xml: true,
                displayMode: display,
                throwOnError: true,
            });
            if (!/^<math[\s>]/.test(mathml.trim())) throw new Error("Temml did not return MathML");
            // Temml marks equation-number slots with an empty
            // <span class="tml-eqn"></span> inside <mtext>. The OMML converter
            // has no mapping for span and warns on each one; the span carries
            // no content, so dropping it loses nothing. Spans WITH content are
            // left in place so a real unsupported construct still warns.
            const cleaned = mathml.replace(/<span\b[^>]*>\s*<\/span>/g, "");
            // disableDecode keeps MathML's &lt; / &amp; entities intact: the
            // converter otherwise decodes them and writes raw "<" and "&" into
            // <m:t>, producing OMML that is not well-formed XML.
            let omml = window.__mml2omml.mml2omml(cleaned, { disableDecode: true }).trim();
            if (display && !omml.includes("oMathPara")) {
                const ns = /xmlns:m="[^"]+"/.exec(omml);
                const decl = ns ? ns[0] : 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
                omml = `<m:oMathPara ${decl}>${omml}</m:oMathPara>`;
            }
            return importOmml(omml);
        } catch (error) {
            // One bad expression must not sink the whole export.
            console.warn("Equation conversion failed:", source, error);
            return new TextRun({ text: `${display ? "$$" : "$"}${source}${display ? "$$" : "$"}`, italics: true });
        }
    }

    // App.extractMath lifts every equation ($…$, $$…$$, \(…\), \[…\],
    // \begin{…}…) out of the RAW source before marked sees it — the same
    // reservation the preview renders — and hands back the untouched LaTeX.
    // Reserved spans arrive here as \uE000index\uE001 markers.
    const MATH_TOKEN = /\uE000(\d+)\uE001/g;
    const MATH_TOKEN_ONLY = /^\s*\uE000(\d+)\uE001\s*$/;

    function plainRun(text, flags) {
        const options = { text: decodeMarkedEntities(xmlSafe(text)) };
        if (flags.bold) options.bold = true;
        if (flags.italics) options.italics = true;
        if (flags.strike) options.strike = true;
        if (flags.code) {
            options.font = "Consolas";
            options.shading = CODE_SHADING;
        }
        return new TextRun(options);
    }

    // Split literal text into text runs and equation runs.
    function textRuns(text, flags = {}, ctx = {}) {
        if (!text) return [];
        const runs = [];
        let last = 0;
        let match;
        MATH_TOKEN.lastIndex = 0;
        while ((match = MATH_TOKEN.exec(text)) !== null) {
            if (match.index > last) runs.push(plainRun(text.slice(last, match.index), flags));
            const entry = (ctx.mathEntries || [])[Number(match[1])];
            if (entry) {
                // Equations inside links keep their source text.
                if (flags.noMath) runs.push(plainRun(`$${entry.expression}$`, flags));
                else runs.push(mathRun(entry.expression, entry.isDisplay));
            }
            last = match.index + match[0].length;
        }
        if (last < text.length) runs.push(plainRun(text.slice(last), flags));
        return runs;
    }

    // marked inline tokens -> docx paragraph children (TextRun/OMML/hyperlink).
    function inlineChildren(tokens, flags = {}, ctx = {}) {
        const children = [];
        for (const token of tokens || []) {
            switch (token.type) {
                case "escape":
                case "text":
                    children.push(...textRuns(token.text, flags, ctx));
                    break;
                case "strong":
                    children.push(...inlineChildren(token.tokens, { ...flags, bold: true }, ctx));
                    break;
                case "em":
                    children.push(...inlineChildren(token.tokens, { ...flags, italics: true }, ctx));
                    break;
                case "del":
                    children.push(...inlineChildren(token.tokens, { ...flags, strike: true }, ctx));
                    break;
                case "codespan":
                    children.push(plainRun(token.text, { ...flags, code: true }));
                    break;
                case "br":
                    children.push(new TextRun({ break: 1 }));
                    break;
                case "link":
                    // Hyperlinks carry runs only — equations inside links keep their source text.
                    children.push(new ExternalHyperlink({
                        children: inlineChildren(token.tokens, { ...flags, noMath: true }, ctx),
                        link: xmlSafe(token.href),
                    }));
                    break;
                case "image":
                    children.push(imageRun(token, ctx));
                    break;
                case "html":
                    children.push(...textRuns(String(token.text || "").replace(/<[^>]*>/g, " "), flags, ctx));
                    break;
                default:
                    if (token.text) children.push(...textRuns(token.text, flags, ctx));
            }
        }
        return children;
    }

    function imageRun(token, ctx) {
        const image = ctx.images.get(token.href);
        if (image) {
            return new ImageRun({
                data: image.data,
                transformation: { width: image.width, height: image.height },
            });
        }
        return plainRun(token.text ? `[image: ${token.text}]` : "[image]", {});
    }

    // --------------------------------------------------------------- blocks --

    // extractMath wraps a display equation in blank lines, so it lexes as a
    // paragraph holding nothing but one marker. Render that as a centered
    // display equation instead of an inline run.
    function loneDisplayIndex(token) {
        const tokens = token.tokens;
        const text = tokens && tokens.length === 1 && (tokens[0].type === "text" || tokens[0].type === "escape")
            ? tokens[0].text
            : (!tokens || tokens.length === 0 ? token.text : null);
        if (text == null) return -1;
        const match = MATH_TOKEN_ONLY.exec(String(text));
        return match ? Number(match[1]) : -1;
    }

    function paragraphFrom(token, ctx) {
        const index = loneDisplayIndex(token);
        const entry = index >= 0 ? (ctx.mathEntries || [])[index] : null;
        if (entry && entry.isDisplay) {
            return new Paragraph({
                children: [mathRun(entry.expression, true)],
                alignment: AlignmentType.CENTER,
                spacing: { after: 160 },
            });
        }
        const paragraph = { children: inlineChildren(token.tokens, {}, ctx) };
        if (ctx.indentLeft) paragraph.indent = { left: ctx.indentLeft };
        return new Paragraph(paragraph);
    }

    function codeParagraph(text) {
        // Block code is raw source (marked does not escape it): no entity
        // decoding here, only control-character stripping.
        const lines = xmlSafe(String(text || "")).replace(/\n$/, "").split("\n");
        const runs = [];
        lines.forEach((line, index) => {
            if (index > 0) runs.push(new TextRun({ break: 1 }));
            runs.push(new TextRun({ text: line || " ", font: "Consolas", size: 20, shading: CODE_SHADING }));
        });
        return new Paragraph({ children: runs, spacing: { after: 160 } });
    }

    function hrParagraph() {
        return new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 1 } },
            spacing: { after: 160 },
        });
    }

    function taskPrefix(item) {
        if (!item.task) return [];
        return [new TextRun({ text: item.checked ? "☑ " : "☐ " })];
    }

    // marked list tokens (nestable, loose or tight, task items) -> numbered paragraphs.
    function pushList(token, level, ctx, out) {
        const reference = token.ordered ? "ordered" : "bullets";
        const childLevel = Math.min(level + 1, 5);
        for (const item of token.items || []) {
            let firstParagraph = true;
            let sawNestedList = false;
            for (const block of item.tokens || []) {
                if (block.type === "list") {
                    pushList(block, childLevel, ctx, out);
                    sawNestedList = true;
                    continue;
                }
                const inlineTokens = block.tokens || (block.text ? [{ type: "text", text: block.text }] : []);
                if (block.type === "paragraph" || block.type === "text") {
                    const runs = [
                        ...(firstParagraph ? taskPrefix(item) : []),
                        ...inlineChildren(inlineTokens, {}, ctx),
                    ];
                    out.push(new Paragraph({ children: runs, numbering: { reference, level } }));
                    firstParagraph = false;
                } else if (block.type === "code") {
                    out.push(codeParagraph(block.text));
                } else if (block.text || block.tokens) {
                    out.push(new Paragraph({
                        children: inlineChildren(inlineTokens, {}, ctx),
                        numbering: { reference, level },
                    }));
                    firstParagraph = false;
                }
            }
            // A list item that contains only a nested list still needs its own marker.
            if (firstParagraph && !sawNestedList) {
                out.push(new Paragraph({ children: taskPrefix(item), numbering: { reference, level } }));
            }
        }
    }

    function tableBorders() {
        const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
        return {
            top: border, bottom: border, left: border, right: border,
            insideHorizontal: border, insideVertical: border,
        };
    }

    function tableCell(cell, ctx, align, bold) {
        const alignment = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT }[align];
        const tokens = cell.tokens || (cell.text ? [{ type: "text", text: cell.text }] : []);
        const options = { children: inlineChildren(tokens, bold ? { bold: true } : {}, ctx) };
        if (alignment) options.alignment = alignment;
        return new TableCell({ children: [new Paragraph(options)] });
    }

    function pushTable(token, ctx, out) {
        const aligns = token.align || [];
        const headerRow = new TableRow({
            tableHeader: true,
            children: (token.header || []).map((cell, index) => tableCell(cell, ctx, aligns[index], true)),
        });
        const rows = (token.rows || []).map((row) => new TableRow({
            children: row.map((cell, index) => tableCell(cell, ctx, aligns[index], false)),
        }));
        out.push(new Table({
            rows: [headerRow, ...rows],
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: tableBorders(),
        }));
        out.push(new Paragraph({ children: [] }));
    }

    // marked block tokens -> docx paragraphs (ctx carries image bytes + indent).
    function blockChildren(tokens, ctx, out) {
        for (const token of tokens || []) {
            switch (token.type) {
                case "space":
                    break;
                case "heading":
                    out.push(new Paragraph({
                        heading: HeadingLevel[`HEADING_${Math.min(token.depth, 6)}`],
                        children: inlineChildren(token.tokens, {}, ctx),
                    }));
                    break;
                case "paragraph":
                    out.push(paragraphFrom(token, ctx));
                    break;
                case "text":
                    out.push(paragraphFrom({ tokens: token.tokens || [{ type: "text", text: token.text }] }, ctx));
                    break;
                case "code":
                    out.push(codeParagraph(token.text));
                    break;
                case "hr":
                    out.push(hrParagraph());
                    break;
                case "blockquote": {
                    const inner = { ...ctx, indentLeft: (ctx.indentLeft || 0) + 720 };
                    blockChildren(token.tokens, inner, out);
                    break;
                }
                case "list":
                    pushList(token, 0, ctx, out);
                    break;
                case "table":
                    pushTable(token, ctx, out);
                    break;
                case "html": {
                    // Aligned HTML blocks keep their alignment in DOCX
                    // (preview and HTML export render the same markup).
                    const raw = String(token.text || "");
                    const align = raw.match(/<\w+[^>]*\balign="([a-z]+)"/i) ||
                        raw.match(/class="[^"]*\balign(left|center|right)\b/i);
                    const alignValue = align ? align[1].toLowerCase() : "";
                    const alignment = alignValue === "center"
                        ? AlignmentType.CENTER
                        : alignValue === "right"
                            ? AlignmentType.RIGHT
                            : alignValue === "left"
                                ? AlignmentType.LEFT
                                : null;
                    const text = raw.replace(/<[^>]*>/g, " ").trim();
                    if (!text) break;
                    out.push(new Paragraph({
                        children: textRuns(text, {}, ctx),
                        ...(alignment ? { alignment } : {}),
                    }));
                    break;
                }
                case "def":
                    break;
                default:
                    if (token.tokens) out.push(paragraphFrom(token, ctx));
            }
        }
    }

    // ------------------------------------------------------------- images ----

    function collectImageSrcs(tokens, out) {
        for (const token of tokens || []) {
            if (token.type === "image" && token.href) out.push(token.href);
            if (token.items) token.items.forEach((item) => collectImageSrcs(item.tokens, out));
            if (token.header) token.header.forEach((cell) => collectImageSrcs(cell.tokens, out));
            if (token.rows) token.rows.forEach((row) => row.forEach((cell) => collectImageSrcs(cell.tokens, out)));
            if (token.tokens) collectImageSrcs(token.tokens, out);
        }
        return out;
    }

    // Data-URI pasted images embed offline; unreachable http images degrade to
    // alt text instead of failing the export.
    async function prepareImages(srcs, ctx) {
        await Promise.all([...new Set(srcs)].map(async (src) => {
            try {
                const response = await fetch(src);
                if (!response.ok) return;
                const data = new Uint8Array(await response.arrayBuffer());
                let width = MAX_IMAGE_WIDTH_PX;
                let height = 400;
                try {
                    const bitmap = await createImageBitmap(new Blob([data]));
                    width = bitmap.width;
                    height = bitmap.height;
                    if (bitmap.close) bitmap.close();
                } catch { /* keep fallback dimensions */ }
                const scale = width > MAX_IMAGE_WIDTH_PX ? MAX_IMAGE_WIDTH_PX / width : 1;
                ctx.images.set(src, {
                    data,
                    width: Math.max(1, Math.round(width * scale)),
                    height: Math.max(1, Math.round(height * scale)),
                });
            } catch { /* offline or CORS-blocked: alt-text fallback */ }
        }));
    }

    function numberingConfig() {
        const indent = (level) => ({ left: 720 * (level + 1), hanging: 360 });
        const formats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
        return {
            config: [
                {
                    reference: "bullets",
                    levels: [0, 1, 2, 3, 4, 5].map((level) => ({
                        level,
                        format: LevelFormat.BULLET,
                        text: ["•", "◦", "▪"][level % 3],
                        alignment: AlignmentType.LEFT,
                        style: { paragraph: { indent: indent(level) } },
                    })),
                },
                {
                    reference: "ordered",
                    levels: [0, 1, 2, 3, 4, 5].map((level) => ({
                        level,
                        format: formats[level % 3],
                        text: `%${level + 1}.`,
                        alignment: AlignmentType.LEFT,
                        style: { paragraph: { indent: indent(level) } },
                    })),
                },
            ],
        };
    }

    async function buildChildren(md) {
        // Reserve math from the raw source first — identical to the preview —
        // so marked never sees (and never escapes or splits) LaTeX.
        const { protectedSource, mathEntries } = App.extractMath(md);
        const lexed = window.marked.lexer(protectedSource);
        const ctx = { images: new Map(), mathEntries };

        const srcs = [];
        collectImageSrcs(lexed, srcs);
        await prepareImages(srcs, ctx);

        const out = [];
        blockChildren(lexed, ctx, out);
        return out;
    }

    async function exportDocx() {
        if (!window.docx || !window.temml || !window.__mml2omml) {
            App.showNotice("The Word export library did not load. Reload the app.", true);
            return;
        }
        try {
            const size = App.PAGE_SIZES[App.getPaperSizeKey()];
            const margin = twips(App.PAGE_MARGIN_MM);
            const doc = new Document({
                creator: "MD+LaTeX",
                title: xmlSafe(App.getDocumentTitle()),
                sections: [{
                    properties: {
                        page: {
                            size: { width: twips(size.widthMm), height: twips(size.heightMm) },
                            margin: { top: margin, right: margin, bottom: margin, left: margin },
                        },
                    },
                    children: await buildChildren(elements.editor.value),
                }],
                numbering: numberingConfig(),
            });
            const blob = await Packer.toBlob(doc);
            // await: downloadBlob is sync today, but awaiting keeps the success
            // notice honest if it ever starts returning a promise.
            await App.downloadBlob(blob, `${App.getBaseFileName()}.docx`);
            App.showNotice("Word document exported.");
        } catch (error) {
            console.error(error);
            App.showNotice(`Word export failed: ${error.message}`, true);
        }
    }

    Object.assign(App, { exportDocx });
})();
