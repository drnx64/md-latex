(() => {
    "use strict";

    const { elements, state } = App;

    // Session-only: find state must not leak across reloads.
    const find = {
        matches: [],
        index: -1,
        caseSensitive: false,
        lastQuery: "",
    };

    function getSelectionRange() {
        const { editor } = elements;
        return { start: editor.selectionStart, end: editor.selectionEnd };
    }

    function buildMatches(query) {
        const text = elements.editor.value;
        if (!query) return [];
        const haystack = find.caseSensitive ? text : text.toLowerCase();
        const needle = find.caseSensitive ? query : query.toLowerCase();
        const matches = [];
        let from = 0;
        while (from <= haystack.length - needle.length) {
            const at = haystack.indexOf(needle, from);
            if (at === -1) break;
            matches.push({ start: at, end: at + needle.length });
            from = at + needle.length; // non-overlapping, like native find
        }
        return matches;
    }

    function updateCount() {
        const total = find.matches.length;
        if (!total) {
            elements.findCount.textContent = elements.findInput.value ? "No results" : "";
            return;
        }
        const current = find.index >= 0 ? find.index + 1 : 0;
        elements.findCount.textContent = current ? `${current} of ${total}` : `${total} found`;
    }

    function focusMatch(index, { focusEditor = true } = {}) {
        const { editor } = elements;
        const match = find.matches[index];
        if (!match) return;
        find.index = index;
        // While typing in the find input, keep focus there — just move the
        // editor's selection and scroll so the match is visible.
        if (focusEditor) editor.focus();
        editor.setSelectionRange(match.start, match.end);
        // Keep the match in view (rough scroll — the selection nudges the browser too).
        const before = editor.value.slice(0, match.start).split("\n");
        const lineHeight = Number.parseFloat(window.getComputedStyle(editor).lineHeight) || 20;
        editor.scrollTop = Math.max(0, (before.length - 3) * lineHeight);
        updateCount();
    }

    function runSearch({ keepIndex = false, focusEditor = true } = {}) {
        const query = elements.findInput.value;
        const queryChanged = query !== find.lastQuery;
        find.lastQuery = query;
        find.matches = buildMatches(query);
        if (!find.matches.length) {
            find.index = -1;
            updateCount();
            return;
        }
        if (keepIndex && !queryChanged && find.index >= 0) {
            find.index = Math.min(find.index, find.matches.length - 1);
            updateCount();
            return;
        }
        // Start from the caret so search flows through the document.
        const { start } = getSelectionRange();
        let next = find.matches.findIndex((m) => m.start >= start);
        if (next === -1) next = 0;
        focusMatch(next, { focusEditor });
    }

    function step(delta) {
        if (!find.matches.length) {
            runSearch({ focusEditor: false });
            return;
        }
        const next = (find.index + delta + find.matches.length) % find.matches.length;
        // Focus stays wherever the user is (find input or a toolbar button).
        focusMatch(next, { focusEditor: false });
    }

    function replaceCurrent() {
        if (!find.matches.length) return;
        const { editor } = elements;
        const match = find.index >= 0 ? find.matches[find.index] : null;
        const { start, end } = getSelectionRange();
        // Only replace when the selection really sits on a match (never stomp typing).
        if (!match || start !== match.start || end !== match.end) {
            runSearch({ focusEditor: false });
            return;
        }
        const replacement = elements.replaceInput.value;
        editor.setRangeText(replacement, start, end, "end");
        App.handleEditorInput();
        runSearch({ focusEditor: false }); // re-match from the caret; next hit becomes current
        elements.replaceInput.focus();
    }

    function replaceAll() {
        const query = elements.findInput.value;
        if (!query) return;
        const text = elements.editor.value;
        const haystack = find.caseSensitive ? text : text.toLowerCase();
        const needle = find.caseSensitive ? query : query.toLowerCase();
        const replacement = elements.replaceInput.value;
        let count = 0;
        let out = "";
        let from = 0;
        while (from <= haystack.length - needle.length) {
            const at = haystack.indexOf(needle, from);
            if (at === -1) break;
            out += text.slice(from, at) + replacement;
            from = at + needle.length;
            count += 1;
        }
        if (!count) {
            App.showNotice("Nothing to replace.");
            return;
        }
        out += text.slice(from);
        elements.editor.value = out;
        App.handleEditorInput();
        runSearch();
        App.showNotice(`Replaced ${count} occurrence${count === 1 ? "" : "s"}.`);
        elements.editor.focus();
    }

    function openFind({ withReplace = false } = {}) {
        state.isFindOpen = true;
        elements.findPanel.hidden = false;
        elements.findReplaceRow.hidden = !withReplace;
        elements.findPanel.classList.toggle("is-replace-open", withReplace);
        const { start, end } = getSelectionRange();
        const selected = elements.editor.value.slice(start, end);
        // A multi-line selection is almost never a search term — don't paste it in.
        if (selected && !selected.includes("\n")) {
            elements.findInput.value = selected;
        }
        elements.findInput.focus();
        elements.findInput.select();
        runSearch({ focusEditor: false });
        updateCount();
    }

    function closeFind() {
        state.isFindOpen = false;
        elements.findPanel.hidden = true;
        elements.editor.focus();
    }

    function toggleReplace() {
        if (state.isFindOpen && !elements.findPanel.hidden) {
            const showing = !elements.findReplaceRow.hidden;
            elements.findReplaceRow.hidden = showing;
            elements.findPanel.classList.toggle("is-replace-open", !showing);
            if (showing) elements.findInput.focus();
            else elements.replaceInput.focus();
            return;
        }
        openFind({ withReplace: true });
    }

    function handleFindKeydown(event) {
        if (event.key === "Escape") {
            event.preventDefault();
            closeFind();
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (event.target === elements.replaceInput && event.ctrlKey) replaceAll();
            else if (event.target === elements.replaceInput && !event.shiftKey && !event.ctrlKey) replaceCurrent();
            else step(event.shiftKey ? -1 : 1);
        } else if (event.ctrlKey && event.key.toLowerCase() === "f") {
            event.preventDefault();
            elements.findInput.focus();
            elements.findInput.select();
        } else if (event.ctrlKey && event.key.toLowerCase() === "h") {
            event.preventDefault();
            toggleReplace();
        }
    }

    function bindFindPanel() {
        elements.findInput.addEventListener("input", () => runSearch({ focusEditor: false }));
        elements.findInput.addEventListener("keydown", handleFindKeydown);
        elements.replaceInput.addEventListener("keydown", handleFindKeydown);
        elements.findPrevButton.addEventListener("click", () => step(-1));
        elements.findNextButton.addEventListener("click", () => step(1));
        elements.findReplaceButton.addEventListener("click", replaceCurrent);
        elements.findReplaceAllButton.addEventListener("click", replaceAll);
        elements.findCloseButton.addEventListener("click", closeFind);
        elements.findCaseButton.addEventListener("click", () => {
            find.caseSensitive = !find.caseSensitive;
            elements.findCaseButton.setAttribute("aria-pressed", String(find.caseSensitive));
            runSearch({ keepIndex: true });
            updateCount();
        });
        elements.editor.addEventListener("keyup", (event) => {
            // Arrow keys move the caret — re-anchor a live search there.
            if (!state.isFindOpen || !find.matches.length) return;
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            const { start } = getSelectionRange();
            const exact = find.matches.findIndex((m) => m.start === start);
            if (exact !== -1) find.index = exact;
            updateCount();
        });
    }

    Object.assign(App, {
        openFind,
        closeFind,
        toggleReplace,
        bindFindPanel,
    });
})();
