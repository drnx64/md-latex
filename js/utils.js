(() => {
    "use strict";

    const {
        state,
        elements,
        STORAGE_KEYS,
        NOTICE_DURATION_MS,
        NOTICE_EXIT_MS,
        EXIT_ANIMATION_MS,
        reducedMotionQuery,
    } = App;

    // Native confirm() cannot match the app; this modal resolves a promise.
    let confirmResolver = null;
    let confirmRestoreFocus = null;

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

    // Restarts a CSS animation: drop the class, force a reflow, re-add it.
    function replayClass(element, className) {
        element.classList.remove(className);
        void element.offsetWidth;
        element.classList.add(className);
    }

    function showNotice(message, isError = false) {
        window.clearTimeout(state.noticeTimer);
        window.clearTimeout(state.noticeLeaveTimer);
        elements.notice.classList.remove("is-leaving");
        elements.notice.textContent = message;
        elements.notice.classList.toggle("is-error", isError);
        replayClass(elements.notice, "is-entering");
        state.noticeTimer = window.setTimeout(hideNotice, NOTICE_DURATION_MS);
    }

    function hideNotice() {
        if (elements.notice.textContent === "") return;
        window.clearTimeout(state.noticeLeaveTimer);
        elements.notice.classList.remove("is-entering");
        elements.notice.classList.add("is-leaving");
        state.noticeLeaveTimer = window.setTimeout(() => {
            elements.notice.textContent = "";
            elements.notice.classList.remove("is-leaving", "is-error");
        }, reducedMotionQuery.matches ? 0 : NOTICE_EXIT_MS);
    }

    function showConfirm(message, confirmLabel = "OK") {
        if (confirmResolver) closeConfirm(false);

        elements.modalMessage.textContent = message;
        elements.modalConfirmButton.textContent = confirmLabel;
        elements.modalOverlay.hidden = false;
        state.isConfirmOpen = true;
        confirmRestoreFocus = document.activeElement;

        window.requestAnimationFrame(() => {
            elements.modalOverlay.classList.add("is-open");
            // Focus lands on Cancel: the conservative default for destructive asks.
            elements.modalCancelButton.focus();
        });

        return new Promise((resolve) => { confirmResolver = resolve; });
    }

    function closeConfirm(result) {
        if (!confirmResolver) return;
        const resolver = confirmResolver;
        confirmResolver = null;
        state.isConfirmOpen = false;

        elements.modalOverlay.classList.remove("is-open");
        window.setTimeout(() => {
            elements.modalOverlay.hidden = true;
            const restoreTarget = confirmRestoreFocus;
            confirmRestoreFocus = null;
            if (restoreTarget && restoreTarget.isConnected) restoreTarget.focus();
        }, reducedMotionQuery.matches ? 0 : EXIT_ANIMATION_MS);

        resolver(result);
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
        replayClass,
        showNotice,
        showConfirm,
        closeConfirm,
        ensureMarkdownExtension,
        getBaseFileName,
        getDocumentTitle,
        downloadBlob,
        readStorage,
        writeStorage,
        loadSavedDocument,
    });
})();
