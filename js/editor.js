(() => {
    "use strict";

    const { elements, LINE_MARKER_PATTERN, LIST_LINE_PATTERN } = App;

    function replaceEditorRange(rangeStart, rangeEnd, replacement, selectionStart, selectionEnd) {
        const editor = elements.editor;
        editor.focus();
        editor.setSelectionRange(rangeStart, rangeEnd);

        // execCommand keeps the browser's undo stack intact. setRangeText is the fallback.
        const command = replacement === "" ? "delete" : "insertText";
        const wasApplied = document.execCommand(command, false, replacement === "" ? undefined : replacement);

        if (!wasApplied) {
            editor.setRangeText(replacement, rangeStart, rangeEnd, "end");
            editor.dispatchEvent(new Event("input", { bubbles: true }));
        }

        editor.setSelectionRange(selectionStart, selectionEnd);
    }

    function wrapSelection(before, after, placeholder) {
        const { selectionStart, selectionEnd, value } = elements.editor;
        const selectedText = value.slice(selectionStart, selectionEnd);

        const isAlreadyWrapped = selectedText !== ""
            && value.slice(selectionStart - before.length, selectionStart) === before
            && value.slice(selectionEnd, selectionEnd + after.length) === after;

        if (isAlreadyWrapped) {
            const unwrappedStart = selectionStart - before.length;
            replaceEditorRange(unwrappedStart, selectionEnd + after.length, selectedText,
                unwrappedStart, unwrappedStart + selectedText.length);
            return;
        }

        const innerText = selectedText || placeholder;
        const innerStart = selectionStart + before.length;
        replaceEditorRange(selectionStart, selectionEnd, `${before}${innerText}${after}`,
            innerStart, innerStart + innerText.length);
    }

    function insertLinkOrImage(prefix, textPlaceholder) {
        const { selectionStart, selectionEnd, value } = elements.editor;
        const labelText = value.slice(selectionStart, selectionEnd) || textPlaceholder;
        const addressPlaceholder = "https://";
        const insertion = `${prefix}[${labelText}](${addressPlaceholder})`;
        const addressStart = selectionStart + prefix.length + labelText.length + 3;

        replaceEditorRange(selectionStart, selectionEnd, insertion,
            addressStart, addressStart + addressPlaceholder.length);
    }

    function toggleLinePrefix(buildPrefix, detectPattern) {
        const { selectionStart, selectionEnd, value } = elements.editor;
        const searchFrom = selectionEnd > selectionStart && value[selectionEnd - 1] === "\n"
            ? selectionEnd - 1
            : selectionEnd;

        const blockStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
        const nextLineBreak = value.indexOf("\n", searchFrom);
        const blockEnd = nextLineBreak === -1 ? value.length : nextLineBreak;

        const lines = value.slice(blockStart, blockEnd).split("\n");
        const filledLines = lines.filter((line) => line.trim() !== "");
        const shouldRemovePrefix = filledLines.length > 0 && filledLines.every((line) => detectPattern.test(line));

        let prefixedLineCount = 0;
        const updatedLines = lines.map((line) => {
            if (line.trim() === "" && lines.length > 1) return line;
            const strippedLine = line.replace(LINE_MARKER_PATTERN, "");
            if (shouldRemovePrefix) return strippedLine;
            prefixedLineCount += 1;
            return buildPrefix(prefixedLineCount) + strippedLine;
        });

        const updatedBlock = updatedLines.join("\n");
        replaceEditorRange(blockStart, blockEnd, updatedBlock, blockStart, blockStart + updatedBlock.length);
    }

    function insertBlock(blockText, selectStartOffset, selectEndOffset) {
        const { selectionStart, selectionEnd, value } = elements.editor;
        const textBefore = value.slice(0, selectionStart);
        const textAfter = value.slice(selectionEnd);

        let leadingBreak = "\n\n";
        if (textBefore === "" || textBefore.endsWith("\n\n")) leadingBreak = "";
        else if (textBefore.endsWith("\n")) leadingBreak = "\n";

        let trailingBreak = "\n\n";
        if (textAfter === "" || textAfter.startsWith("\n\n")) trailingBreak = "";
        else if (textAfter.startsWith("\n")) trailingBreak = "\n";

        const blockStart = selectionStart + leadingBreak.length;
        replaceEditorRange(selectionStart, selectionEnd, `${leadingBreak}${blockText}${trailingBreak}`,
            blockStart + selectStartOffset, blockStart + selectEndOffset);
    }

    function insertFencedBlock(openingFence, closingFence, placeholder) {
        const { selectionStart, selectionEnd, value } = elements.editor;
        const content = value.slice(selectionStart, selectionEnd) || placeholder;
        const contentOffset = openingFence.length + 1;
        insertBlock(`${openingFence}\n${content}\n${closingFence}`, contentOffset, contentOffset + content.length);
    }

    function insertTable() {
        const tableText = "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |";
        insertBlock(tableText, 2, 10);
    }

    const FORMAT_ACTIONS = {
        bold: () => wrapSelection("**", "**", "bold text"),
        italic: () => wrapSelection("*", "*", "italic text"),
        strikethrough: () => wrapSelection("~~", "~~", "struck text"),
        inlineCode: () => wrapSelection("`", "`", "code"),
        heading1: () => toggleLinePrefix(() => "# ", /^#\s/),
        heading2: () => toggleLinePrefix(() => "## ", /^##\s/),
        heading3: () => toggleLinePrefix(() => "### ", /^###\s/),
        heading4: () => toggleLinePrefix(() => "#### ", /^####\s/),
        paragraph: () => toggleLinePrefix(() => "", /^#{1,6}\s/),
        bulletList: () => toggleLinePrefix(() => "- ", /^[-*+]\s(?!\[[ xX]\])/),
        orderedList: () => toggleLinePrefix((lineNumber) => `${lineNumber}. `, /^\d+\.\s/),
        taskList: () => toggleLinePrefix(() => "- [ ] ", /^[-*+]\s\[[ xX]\]\s/),
        quote: () => toggleLinePrefix(() => "> ", /^>/),
        link: () => insertLinkOrImage("", "link text"),
        image: () => insertLinkOrImage("!", "alt text"),
        table: insertTable,
        codeBlock: () => insertFencedBlock("```", "```", "code"),
        horizontalRule: () => insertBlock("---", 3, 3),
        inlineMath: () => wrapSelection("$", "$", "x^2"),
        blockMath: () => insertFencedBlock("$$", "$$", "E = mc^2"),
        // Math templates wrap in $...$ like inlineMath; the caret lands in the first slot.
        fraction: () => wrapSelection("$\\frac{", "}{}$", ""),
        squareRoot: () => wrapSelection("$\\sqrt{", "}$", ""),
        summation: () => wrapSelection("$\\sum_{", "}^{}$", ""),
        integral: () => wrapSelection("$\\int_{", "}^{}$", ""),
        matrix: () => insertBlock(String.raw`$$
\begin{pmatrix}
1 & 0 \\
0 & 1
\end{pmatrix}
$$`, 18, 18),
        alignEnvironment: () => insertBlock(String.raw`\begin{align}

\end{align}`, 14, 14),
    };

    function applyFormat(formatName) {
        const formatAction = FORMAT_ACTIONS[formatName];
        if (formatAction) formatAction();
    }

    // Mirrors the caret's line into the H1▾ trigger label (H1..H4 or P).
    function updateTextLevelIndicator() {
        const label = elements.headingTriggerLabel;
        const trigger = elements.headingMenuButton;
        if (!label || !trigger) return;

        const { value, selectionStart } = elements.editor;
        const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
        const lineEnd = value.indexOf("\n", selectionStart);
        const line = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
        const match = line.match(/^(#{1,6})(\s|$)/);
        const level = match ? `H${match[1].length}` : "P";

        label.textContent = level;
        trigger.setAttribute("aria-label", `Text level: ${level}`);
        trigger.title = `Text level: ${level}`;
    }

    function continueListOnEnter() {
        const { value, selectionStart, selectionEnd } = elements.editor;
        if (selectionStart !== selectionEnd) return false;

        const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
        const lineBeforeCursor = value.slice(lineStart, selectionStart);
        const listMatch = lineBeforeCursor.match(LIST_LINE_PATTERN);
        if (!listMatch) return false;

        const [, indentation, marker, taskBox, itemContent] = listMatch;

        if (itemContent.trim() === "") {
            replaceEditorRange(lineStart, selectionStart, "", lineStart, lineStart);
            return true;
        }

        const nextMarker = /^\d/.test(marker) ? `${parseInt(marker, 10) + 1}.` : marker;
        const nextTaskBox = taskBox ? "[ ] " : "";
        const insertion = `\n${indentation}${nextMarker} ${nextTaskBox}`;
        const cursorPosition = selectionStart + insertion.length;

        replaceEditorRange(selectionStart, selectionEnd, insertion, cursorPosition, cursorPosition);
        return true;
    }

    const SHORTCUT_ACTIONS = {
        b: () => applyFormat("bold"),
        i: () => applyFormat("italic"),
        k: () => applyFormat("link"),
        s: () => App.downloadMarkdown(),
        o: () => elements.fileInput.click(),
    };

    function handleEditorKeydown(event) {
        const hasModifier = event.ctrlKey || event.metaKey;

        if (event.key === "Enter" && !hasModifier && !event.shiftKey && !event.altKey && !event.isComposing) {
            if (continueListOnEnter()) event.preventDefault();
            return;
        }

        if (!hasModifier || event.altKey) return;

        const shortcutAction = SHORTCUT_ACTIONS[event.key.toLowerCase()];
        if (!shortcutAction) return;

        event.preventDefault();
        shortcutAction();
    }

    function handleGlobalKeydown(event) {
        const hasModifier = event.ctrlKey || event.metaKey;
        if (!hasModifier || event.altKey || event.target === elements.editor) return;

        const key = event.key.toLowerCase();
        if (key === "s") {
            event.preventDefault();
            App.downloadMarkdown();
        } else if (key === "o") {
            event.preventDefault();
            elements.fileInput.click();
        }
    }

    Object.assign(App, { applyFormat, handleEditorKeydown, handleGlobalKeydown, updateTextLevelIndicator });
})();
