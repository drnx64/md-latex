(() => {
    "use strict";

    const {
        MATH_TOKEN_START,
        MATH_TOKEN_END,
        MATH_TOKEN_PATTERN,
        DISPLAY_MATH_PARAGRAPH_PATTERN,
        CODE_SPAN_PATTERN,
        DISPLAY_DOLLAR_PATTERN,
        LATEX_ENVIRONMENT_PATTERN,
        DISPLAY_BRACKET_PATTERN,
        INLINE_PAREN_PATTERN,
        INLINE_DOLLAR_PATTERN,
    } = App;

    function replaceMath(textSegment, reserveMath) {
        return textSegment
            .replace(DISPLAY_DOLLAR_PATTERN, (fullMatch, expression) => reserveMath(expression, true))
            .replace(LATEX_ENVIRONMENT_PATTERN, (fullMatch) => reserveMath(fullMatch, true))
            .replace(DISPLAY_BRACKET_PATTERN, (fullMatch, expression) => reserveMath(expression, true))
            .replace(INLINE_PAREN_PATTERN, (fullMatch, expression) => reserveMath(expression, false))
            .replace(INLINE_DOLLAR_PATTERN, (fullMatch, expression) => reserveMath(expression, false));
    }

    function extractMath(markdownSource) {
        const mathEntries = [];

        function reserveMath(expression, isDisplay) {
            const entryIndex = mathEntries.push({ expression: expression.trim(), isDisplay }) - 1;
            const token = `${MATH_TOKEN_START}${entryIndex}${MATH_TOKEN_END}`;
            return isDisplay ? `\n\n${token}\n\n` : token;
        }

        // Splitting on a capture group puts code at odd indexes, so code is never touched.
        const protectedSource = markdownSource
            .split(CODE_SPAN_PATTERN)
            .map((segment, segmentIndex) => (segmentIndex % 2 === 1 ? segment : replaceMath(segment, reserveMath)))
            .join("");

        return { protectedSource, mathEntries };
    }

    function renderMathEntry(mathEntry) {
        try {
            return window.katex.renderToString(prepareMath(mathEntry.expression), {
                displayMode: mathEntry.isDisplay,
                throwOnError: false,
                strict: "ignore",
                trust: false,
                output: "htmlAndMathml",
            });
        } catch (error) {
            return `<code class="math-error">${App.escapeHtml(mathEntry.expression)}</code>`;
        }
    }

    function restoreMath(sanitizedHtml, mathEntries) {
        return sanitizedHtml
            .replace(DISPLAY_MATH_PARAGRAPH_PATTERN, (fullMatch, entryIndex) => renderMathEntry(mathEntries[Number(entryIndex)]))
            .replace(MATH_TOKEN_PATTERN, (fullMatch, entryIndex) => renderMathEntry(mathEntries[Number(entryIndex)]));
    }

    // ------------------------------------------------------------ features --

    // KaTeX accepts \vspace but drops it silently; a zero-width strut of the
    // same height produces the gap the author asked for.
    function convertVspace(tex) {
        return tex.replace(/\\vspace\*?\s*\{([^{}]+)\}/g, (fullMatch, dimension) => {
            return `\\rule{0pt}{${dimension.trim()}}`;
        });
    }

    // ---- auto-alignment ---------------------------------------------------
    // Inside align-family environments a row with no alignment tab gets an
    // "&" before its first top-level relation, so "= a \\ = b" lines up at
    // the equals sign without the author typing "&".

    const ALIGN_ENV_NAMES = new Set([
        "align", "align*", "aligned",
        "eqnarray", "eqnarray*",
        "flalign", "flalign*",
    ]);
    const ENV_TOKEN_PATTERN = /\\(begin|end)\{([^{}]+)\}/g;
    const RELATION_RUN = ":!<=>";

    // Outermost \begin…\end spans in body: the row scanner jumps over each
    // one whole, so nested environments (and their "&"s) stay untouched.
    function findNestedAtoms(body) {
        const spans = [];
        const stack = [];
        let match;
        ENV_TOKEN_PATTERN.lastIndex = 0;
        while ((match = ENV_TOKEN_PATTERN.exec(body)) !== null) {
            if (match[1] === "begin") {
                stack.push({ name: match[2], start: match.index });
            } else if (stack.length > 0 && stack[stack.length - 1].name === match[2]) {
                const open = stack.pop();
                spans.push({ start: open.start, end: match.index + match[0].length });
            }
        }
        spans.sort((a, b) => a.start - b.start || b.end - a.end);
        const outer = [];
        let coveredUntil = -1;
        spans.forEach((span) => {
            if (span.start >= coveredUntil) {
                outer.push(span);
                coveredUntil = span.end;
            }
        });
        return outer;
    }

    // Every align-family region in text, innermost regions first (they close
    // first). Boundaries are indices into the string they were scanned on.
    function findAlignRegions(text) {
        const regions = [];
        const stack = [];
        let match;
        ENV_TOKEN_PATTERN.lastIndex = 0;
        while ((match = ENV_TOKEN_PATTERN.exec(text)) !== null) {
            if (match[1] === "begin") {
                stack.push({ name: match[2], contentStart: match.index + match[0].length });
            } else if (stack.length > 0 && stack[stack.length - 1].name === match[2]) {
                const open = stack.pop();
                if (ALIGN_ENV_NAMES.has(open.name)) {
                    regions.push({ contentStart: open.contentStart, contentEnd: match.index });
                }
            }
        }
        return regions;
    }

    // Absolute positions in body where "&" should be inserted: the first
    // top-level relation of every row that has no top-level "&" yet. Rows
    // inside {…} / \left…\right groups, %-comments and nested environments
    // are never touched; a relation run (": ! < > =") aligns at its start.
    function findAlignmentInserts(body) {
        const atoms = findNestedAtoms(body);
        const inserts = [];
        let atomIndex = 0;
        let depth = 0;
        let delimiters = 0;
        let inComment = false;
        let rowStart = 0;
        let rowHasAmp = false;
        let rowInsert = -1;

        function closeRow(rowEnd, nextRowStart) {
            if (!rowHasAmp && rowInsert >= 0 && rowInsert >= rowStart && rowInsert <= rowEnd) {
                inserts.push(rowInsert);
            }
            rowStart = nextRowStart;
            rowHasAmp = false;
            rowInsert = -1;
        }

        let index = 0;
        while (index < body.length) {
            if (inComment) {
                if (body[index] === "\n") inComment = false;
                index += 1;
                continue;
            }
            if (atomIndex < atoms.length && index === atoms[atomIndex].start) {
                index = atoms[atomIndex].end;
                atomIndex += 1;
                continue;
            }

            const char = body[index];
            if (char === "%") {
                inComment = true;
                index += 1;
                continue;
            }
            if (char === "\\") {
                const command = /^\\([a-zA-Z]+)/.exec(body.slice(index, index + 12));
                if (command) {
                    const name = command[0];
                    if (name === "\\left") {
                        delimiters += 1;
                    } else if (name === "\\right") {
                        delimiters -= 1;
                    } else if (name === "\\not") {
                        // \not= is one glyph, not a relation to align on.
                        index += name.length;
                        if (index < body.length && "=<>".includes(body[index])) index += 1;
                        continue;
                    }
                    index += name.length;
                    continue;
                }
                // Two-character forms: the \\ row break (\\* and \\[len]
                // variants) and escapes such as \{ \, \$.
                const pair = body.slice(index, index + 2);
                if (pair === "\\\\") {
                    let end = index + 2;
                    if (body[end] === "*") end += 1;
                    const optional = /^\[[^\]]*\]/.exec(body.slice(end));
                    if (optional) end += optional[0].length;
                    if (depth === 0 && delimiters === 0) closeRow(index, end);
                    index = end;
                    continue;
                }
                index += 2;
                continue;
            }
            if (char === "{") {
                depth += 1;
            } else if (char === "}") {
                depth = Math.max(0, depth - 1);
            } else if (depth === 0 && delimiters === 0 && char === "&") {
                rowHasAmp = true;
            } else if (depth === 0 && delimiters === 0 && char === "=" && rowInsert === -1) {
                let start = index;
                while (start > rowStart && RELATION_RUN.includes(body[start - 1])) start -= 1;
                // Never land on the "=" of an escaped \=.
                if (start > 0 && body[start - 1] === "\\") start = index;
                rowInsert = start;
            }
            index += 1;
        }
        closeRow(body.length, body.length);
        return inserts;
    }

    function autoAlignMath(tex) {
        if (typeof tex !== "string" || tex.indexOf("\\begin{") === -1) return tex;
        let current = tex;
        // One region per pass, then re-scan: splicing shifts every later
        // boundary, and a fresh scan keeps nested regions exact. Each pass
        // either grows the string (rows get their "&" and are then skipped)
        // or settles.
        for (;;) {
            const regions = findAlignRegions(current);
            let next = current;
            for (const region of regions) {
                const body = current.slice(region.contentStart, region.contentEnd);
                const inserts = findAlignmentInserts(body);
                if (inserts.length === 0) continue;
                let patched = body;
                for (let i = inserts.length - 1; i >= 0; i -= 1) {
                    patched = patched.slice(0, inserts[i]) + "&" + patched.slice(inserts[i]);
                }
                next = current.slice(0, region.contentStart) + patched + current.slice(region.contentEnd);
                break;
            }
            if (next === current) break;
            current = next;
        }
        return current;
    }

    // Shared by the preview renderer and the DOCX exporter so both see the
    // same transformed source.
    function prepareMath(tex) {
        return autoAlignMath(convertVspace(tex));
    }

    Object.assign(App, { extractMath, restoreMath, prepareMath });
})();
