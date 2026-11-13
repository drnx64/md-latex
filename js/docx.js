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

    // ---------------------------------------------------------------- math --
    // raw LaTeX -> MathML (Temml) -> OMML (mathml2omml) -> docx XML node.
    function mathRun(tex, display) {
        try {
            const mathml = window.temml.renderToString(tex, { xml: true, displayMode: display });
            let omml = window.__mml2omml.mml2omml(mathml).trim();
            if (display && !omml.includes("oMathPara")) {
                const ns = /xmlns:m="[^"]+"/.exec(omml);
                const decl = ns ? ns[0] : 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
                omml = `<m:oMathPara ${decl}>${omml}</m:oMathPara>`;
            }
            return ImportedXmlComponent.fromXmlString(omml);
        } catch (error) {
            // One bad expression must not sink the whole export.
            console.warn("Equation conversion failed:", tex, error);
            return new TextRun({ text: `${display ? "$$" : "$"}${tex}${display ? "$$" : "$"}`, italics: true });
        }
    }

    // $...$ inline, $$...$$ display; a literal $ must be escaped (\$) and the
    // content may not touch whitespace at either end (keeps "$5 and $10" prose
    // from being read as math).
    const INLINE_MATH_RE = /(?<!\\)\$\$([^$]+?)\$\$|(?<!\\)\$([^$\s](?:[^$]*[^$\s])?)\$/g;

    function plainRun(text, flags) {
        const options = { text };
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
    function textRuns(text, flags = {}) {
        if (!text) return [];
        const runs = [];
        let last = 0;
        let match;
        INLINE_MATH_RE.lastIndex = 0;
        while ((match = INLINE_MATH_RE.exec(text)) !== null) {
            if (match.index > last) runs.push(plainRun(text.slice(last, match.index), flags));
            const tex = (match[1] !== undefined ? match[1] : match[2]).trim();
            if (tex && flags.noMath) runs.push(plainRun(tex, flags));
            else if (tex) runs.push(mathRun(tex, match[1] !== undefined));
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
                    children.push(...textRuns(token.text, flags));
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
                        link: token.href,
                    }));
                    break;
                case "image":
                    children.push(imageRun(token, ctx));
                    break;
                case "html":
                    children.push(...textRuns(String(token.text || "").replace(/<[^>]*>/g, " "), flags));
                    break;
                default:
                    if (token.text) children.push(...textRuns(token.text, flags));
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

    function paragraphFrom(token, ctx) {
        const paragraph = { children: inlineChildren(token.tokens, {}, ctx) };
        if (ctx.indentLeft) paragraph.indent = { left: ctx.indentLeft };
        return new Paragraph(paragraph);
    }

    function codeParagraph(text) {
        const lines = String(text || "").replace(/\n$/, "").split("\n");
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
                    const text = String(token.text || "").replace(/<[^>]*>/g, " ").trim();
                    if (text) out.push(new Paragraph({ children: textRuns(text, {}) }));
                    break;
                }
                case "def":
                    break;
                default:
                    if (token.tokens) out.push(paragraphFrom(token, ctx));
            }
        }
    }

    // ---------------------------------------------------- display math split --

    // $$ blocks that own their lines are lifted out before lexing so the raw
    // LaTeX reaches Temml untouched (no markdown escaping, no KaTeX DOM).
    function splitDisplayMath(md) {
        const parts = [];
        const re = /\$\$([\s\S]+?)\$\$/g;
        let last = 0;
        let match;
        while ((match = re.exec(md)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            const lineStart = md.lastIndexOf("\n", start - 1) + 1;
            const lineEnd = md.indexOf("\n", end);
            const ownsLine = /^\s*$/.test(md.slice(lineStart, start)) &&
                (lineEnd === -1 || /^\s*$/.test(md.slice(end, lineEnd)));
            if (!ownsLine) continue;
            if (start > last) parts.push({ type: "md", text: md.slice(last, start) });
            parts.push({ type: "math", tex: match[1].trim() });
            last = end;
        }
        if (last < md.length) parts.push({ type: "md", text: md.slice(last) });
        return parts;
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
        const parts = splitDisplayMath(md);
        const ctx = { images: new Map() };
        const srcs = [];
        parts.forEach((part) => {
            if (part.type === "md") collectImageSrcs(window.marked.lexer(part.text), srcs);
        });
        await prepareImages(srcs, ctx);

        const out = [];
        for (const part of parts) {
            if (part.type === "math") {
                out.push(new Paragraph({
                    children: [mathRun(part.tex, true)],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 160 },
                }));
            } else {
                blockChildren(window.marked.lexer(part.text), ctx, out);
            }
        }
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
                title: App.getDocumentTitle(),
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
            App.downloadBlob(blob, `${App.getBaseFileName()}.docx`);
            App.showNotice("Word document exported.");
        } catch (error) {
            console.error(error);
            App.showNotice(`Word export failed: ${error.message}`, true);
        }
    }

    Object.assign(App, { exportDocx });
})();
