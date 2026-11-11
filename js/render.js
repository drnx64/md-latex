(() => {
    "use strict";

    const { state, elements, RENDER_DELAY_MS, READING_WORDS_PER_MINUTE } = App;

    function getMissingLibraries() {
        const requiredLibraries = { marked: "marked", DOMPurify: "DOMPurify", katex: "katex" };
        return Object.keys(requiredLibraries).filter((name) => !(name in window));
    }

    function renderPreview() {
        const missingLibraries = getMissingLibraries();
        if (missingLibraries.length > 0) {
            elements.preview.innerHTML = `<p class="render-error">Could not load: ${App.escapeHtml(missingLibraries.join(", "))}. Check your connection and reload.</p>`;
            return;
        }

        const { protectedSource, mathEntries } = App.extractMath(elements.editor.value);
        const rawHtml = window.marked.parse(protectedSource);
        const sanitizedHtml = window.DOMPurify.sanitize(rawHtml);
        elements.preview.innerHTML = App.restoreMath(sanitizedHtml, mathEntries);

        if (window.Prism) window.Prism.highlightAllUnder(elements.preview);
        updateStatistics();
    }

    function scheduleRender() {
        window.clearTimeout(state.renderTimer);
        state.renderTimer = window.setTimeout(renderPreview, RENDER_DELAY_MS);
    }

    function updateStatistics() {
        const sourceText = elements.editor.value;
        const wordTotal = (sourceText.trim().match(/\S+/g) || []).length;
        const readingMinutes = Math.ceil(wordTotal / READING_WORDS_PER_MINUTE);

        elements.wordCount.textContent = `${wordTotal} ${wordTotal === 1 ? "word" : "words"}`;
        elements.characterCount.textContent = `${sourceText.length} characters`;
        elements.readingTime.textContent = `${readingMinutes} min read`;
    }

    Object.assign(App, { renderPreview, scheduleRender });
})();
