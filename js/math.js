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
            return window.katex.renderToString(mathEntry.expression, {
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

    Object.assign(App, { extractMath, restoreMath });
})();
