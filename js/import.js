(() => {
    "use strict";

    // -------------------------------------------------------- HTML import --
    // Opening an HTML file (ours or a third party's) yields Markdown:
    // 1. Mark⁺ exports embed a <script type="text/markdown"> source marker —
    //    parsed back with JSON.parse for a lossless round-trip.
    // 2. Otherwise the DOM is walked back to Markdown. Alignment survives as
    //    the align attribute, an .align* class, or an inline text-align style.

    const BLOCK_TAGS = new Set([
        "P", "DIV", "SECTION", "ARTICLE", "ASIDE", "HEADER", "FOOTER",
        "H1", "H2", "H3", "H4", "H5", "H6",
        "UL", "OL", "DL", "TABLE", "PRE", "BLOCKQUOTE", "HR", "FIGURE",
        "FIGCAPTION", "DETAILS", "SUMMARY", "ADDRESS",
    ]);

    const HEADING_LEVELS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

    // Alignment the preview/export would have applied: an align attribute, an
    // .alignleft/.aligncenter/.alignright class, or an inline text-align.
    function getAlignment(node) {
        const attribute = (node.getAttribute("align") || "").toLowerCase();
        if (attribute === "left" || attribute === "center" || attribute === "right") return attribute;
        for (const name of ["alignleft", "aligncenter", "alignright"]) {
            if (node.classList && node.classList.contains(name)) {
                return name === "aligncenter" ? "center" : name.slice(5);
            }
        }
        const inline = (node.style && node.style.textAlign || "").toLowerCase();
        if (inline === "left" || inline === "center" || inline === "right") return inline;
        return "";
    }

    function isBlockNode(node) {
        return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName);
    }

    // Walks block-level children, buffering runs of inline nodes into
    // paragraphs. inheritedAlignment flows a wrapper's alignment down to
    // children that don't set their own (text-align inherits in the preview).
    function blockChildren(node, blocks, inheritedAlignment = "", depth = 0) {
        const alignment = getAlignment(node) || inheritedAlignment;
        let inlineBuffer = [];
        const flushInline = () => {
            if (!inlineBuffer.length) return;
            const nodes = inlineBuffer;
            inlineBuffer = [];
            blocks.push(...paragraphFromInline(nodes, alignment));
        };
        for (const child of node.childNodes) {
            if (child.nodeType === Node.COMMENT_NODE) continue;
            if (isBlockNode(child)) {
                flushInline();
                blocks.push(...blockNode(child, alignment, depth));
            } else {
                inlineBuffer.push(child);
            }
        }
        flushInline();
    }

    function paragraphFromInline(nodes, alignment) {
        const body = inlineText(nodes)
            .trim()
            // A task marker needs exactly one space before its text.
            .replace(/^(\[[ x]\])(\S)/, "$1 $2");
        if (!body) return [];
        // Aligned blocks keep their alignment as HTML: the preview and the
        // HTML export render it from the same markup.
        if (alignment) return [`<p align="${alignment}">${body}</p>`];
        return [body];
    }

    function blockNode(node, alignment, depth) {
        const tag = node.tagName;
        if (tag === "HR") return ["---"];
        if (tag === "PRE") return [fencedCode(node)];
        if (HEADING_LEVELS[tag]) {
            const text = inlineText([node]).replace(/\r?\n/g, " ").trim();
            return text ? [`${"#".repeat(HEADING_LEVELS[tag])} ${text}`] : [];
        }
        if (tag === "BLOCKQUOTE") {
            const text = blockquote(node, depth);
            return text ? [text] : [];
        }
        if (tag === "UL" || tag === "OL") {
            const text = listMarkdown(node, depth, tag === "OL");
            return text ? [text] : [];
        }
        if (tag === "DL") {
            const text = definitionList(node);
            return text ? [text] : [];
        }
        if (tag === "TABLE") {
            const text = tableMarkdown(node);
            return text ? [text] : [];
        }
        return paragraphFromInline([...node.childNodes], getAlignment(node) || alignment);
    }

    function blockquote(node, depth) {
        const inner = [];
        blockChildren(node, inner, "", depth);
        if (!inner.length) return "";
        return inner
            .join("\n\n")
            .split("\n")
            .map((line) => (line ? `> ${line}` : ">"))
            .join("\n");
    }

    // Four spaces per list level. A nested list renders at depth + 1, so its
    // lines already carry the full indentation — continuation lines are only
    // indented when they don't start with whitespace themselves.
    function listMarkdown(listNode, depth, ordered) {
        const items = [...listNode.children].filter((child) => child.tagName === "LI");
        const lines = [];
        items.forEach((item, index) => {
            const marker = ordered ? `${index + 1}. ` : "- ";
            const inner = [];
            // depth + 1: nested blocks (lists) indent themselves to the
            // content column of this item, so no further prefixing is needed.
            blockChildren(item, inner, "", depth + 1);
            // A nested list stays tight against its paragraph (a blank line
            // would render the whole list loose); paragraphs stay separated.
            const joined = inner.reduce((text, block, blockIndex) => {
                if (blockIndex === 0) return block;
                const tight = /^\s*([-*+]|\d+[.)])\s/.test(block);
                return `${text}${tight ? "\n" : "\n\n"}${block}`;
            }, "");
            const indent = "    ".repeat(depth);
            joined.split("\n").forEach((line, lineIndex) => {
                if (lineIndex === 0) lines.push(`${indent}${marker}${line}`);
                else if (!line.trim()) lines.push("");
                else if (/^\s/.test(line)) lines.push(line);
                else lines.push(`${indent}    ${line}`);
            });
        });
        return lines.join("\n");
    }

    function definitionList(node) {
        const lines = [];
        for (const child of node.children) {
            if (child.tagName === "DT") {
                lines.push(inlineText([child]).trim());
            } else if (child.tagName === "DD") {
                const inner = [];
                blockChildren(child, inner);
                inner.forEach((line, index) => {
                    lines.push(index === 0 ? `: ${line}` : line ? `    ${line}` : "");
                });
            }
        }
        return lines.join("\n");
    }

    function fencedCode(node) {
        const code = node.textContent.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
        // A fence must be longer than any backtick run inside the code.
        const longestRun = Math.max(0, ...[...code.matchAll(/`+/g)].map((match) => match[0].length));
        const fence = "`".repeat(Math.max(3, longestRun + 1));
        const language = (node.querySelector("code")?.className.match(/language-(\S+)/) || [])[1] || "";
        return `${fence}${language}\n${code}\n${fence}`;
    }

    function tableMarkdown(node) {
        const rowElements = [...node.querySelectorAll("tr")];
        const rows = rowElements
            .map((row, index) => ({
                cells: [...row.children]
                    .filter((cell) => cell.tagName === "TH" || cell.tagName === "TD")
                    .map((cell) => inlineText([cell]).trim().replace(/\|/g, "\\|").replace(/\r?\n/g, " ")),
                hasHeader: Boolean(rowElements[index].querySelector("th")),
            }))
            .filter((row) => row.cells.length);
        if (!rows.length) return "";
        const headerIndex = Math.max(0, rows.findIndex((row) => row.hasHeader));
        const width = Math.max(1, ...rows.map((row) => row.cells.length));
        const pad = (cells) => {
            const padded = [...cells];
            while (padded.length < width) padded.push("");
            return `| ${padded.join(" | ")} |`;
        };
        const lines = [pad(rows[headerIndex].cells), `| ${Array(width).fill("---").join(" | ")} |`];
        rows.forEach((row, index) => {
            if (index !== headerIndex) lines.push(pad(row.cells));
        });
        return lines.join("\n");
    }

    function inlineText(nodes) {
        let out = "";
        for (const node of nodes) out += inlineNode(node);
        return out;
    }

    function inlineNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
        if (node.nodeType !== Node.ELEMENT_NODE) return "";
        const tag = node.tagName;
        const className = String(node.getAttribute("class") || "");

        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return "";

        // KaTeX: the MathML copy carries the original TeX — recover it so
        // equations reopen as editable source, never as markup. The HTML
        // copy is display-only and gets dropped below.
        if (tag === "MATH" || /mathml/.test(className)) {
            const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
            if (tex) {
                const isDisplay = Boolean(node.closest(".katex-display"));
                return isDisplay ? `$$\n${tex}\n$$` : `$${tex}$`;
            }
            if (tag === "MATH") return node.textContent;
        }
        if (/mathml/.test(className) || /katex-html/.test(className)) return "";
        if (node.classList && node.classList.contains("math-error")) return `$${node.textContent}$`;

        const inner = inlineText([...node.childNodes]);

        switch (tag) {
            case "STRONG":
            case "B":
                return `**${inner}**`;
            case "EM":
            case "I":
                return `*${inner}*`;
            case "DEL":
            case "S":
                return `~~${inner}~~`;
            case "CODE":
                return `\`${inner}\``;
            case "A": {
                const href = node.getAttribute("href") || "";
                return href ? `[${inner}](${href})` : inner;
            }
            case "IMG": {
                const src = node.getAttribute("src") || "";
                const alt = node.getAttribute("alt") || "";
                return src ? `![${alt}](${src})` : alt;
            }
            case "BR":
                return "\n";
            case "INPUT":
                // Task-list marker; paragraphFromInline normalizes the space.
                if (!/checkbox/i.test(node.type || "")) return "";
                return node.checked ? "[x]" : "[ ]";
            case "MARK":
                return `<mark>${inner}</mark>`;
            default:
                return inner;
        }
    }

    // Returns { markdown } on success or { error } when the file is neither
    // a Mark⁺ export nor convertible HTML.
    function htmlExportToMarkdown(htmlText) {
        const doc = new DOMParser().parseFromString(htmlText, "text/html");

        // 1. Lossless round-trip: our own exports carry the exact source.
        const marker = doc.querySelector('script[type="text/markdown"]');
        if (marker) {
            try {
                return { markdown: JSON.parse(marker.textContent) };
            } catch (error) {
                // Corrupt marker: fall through to the DOM conversion.
            }
        }

        // 2. Convert whatever DOM the file has (article first: that is where
        // our legacy exports keep the document, not the chrome around it).
        const article = doc.querySelector("article.markdown-body") || doc.body;
        if (!article) return { error: "empty" };

        const blocks = [];
        blockChildren(article, blocks);
        const markdown = `${blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
        if (!markdown.trim()) return { error: "empty" };
        return { markdown };
    }

    Object.assign(App, { htmlExportToMarkdown });
})();
