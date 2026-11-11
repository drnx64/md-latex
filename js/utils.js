(() => {
    "use strict";

    const { state, elements, STORAGE_KEYS, NOTICE_DURATION_MS } = App;

    function escapeHtml(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }

    function showNotice(message, isError = false) {
        elements.notice.textContent = message;
        elements.notice.classList.toggle("is-error", isError);
        window.clearTimeout(state.noticeTimer);
        state.noticeTimer = window.setTimeout(() => {
            elements.notice.textContent = "";
        }, NOTICE_DURATION_MS);
    }

    function ensureMarkdownExtension(fileName) {
        const trimmedName = fileName.trim().replace(/[\\/:*?"<>|]+/g, "-");
        if (trimmedName === "") return "untitled.md";
        return /\.(md|markdown|mdown)$/i.test(trimmedName) ? trimmedName : `${trimmedName}.md`;
    }

    function getBaseFileName() {
        return ensureMarkdownExtension(state.fileName).replace(/\.[^.]+$/, "");
    }

    function getDocumentTitle() {
        const headingMatch = elements.editor.value.match(/^#\s+(.+)$/m);
        return headingMatch ? headingMatch[1].trim() : getBaseFileName();
    }

    function downloadBlob(blob, downloadName) {
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = downloadName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }

    function readStorage(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (error) {
            return null;
        }
    }

    function writeStorage(key, value) {
        try {
            window.localStorage.setItem(key, value);
            return true;
        } catch (error) {
            return false;
        }
    }

    function loadSavedDocument() {
        const rawDocument = readStorage(STORAGE_KEYS.document);
        if (!rawDocument) return null;

        try {
            const parsedDocument = JSON.parse(rawDocument);
            if (typeof parsedDocument?.content !== "string") return null;
            return parsedDocument;
        } catch (error) {
            return null;
        }
    }

    Object.assign(App, {
        escapeHtml,
        clamp,
        showNotice,
        ensureMarkdownExtension,
        getBaseFileName,
        getDocumentTitle,
        downloadBlob,
        readStorage,
        writeStorage,
        loadSavedDocument,
    });
})();
