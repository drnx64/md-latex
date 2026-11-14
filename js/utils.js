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
    let confirmHideTimer = null;

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
        // The replaced modal's pending hide must not hide this one.
        window.clearTimeout(confirmHideTimer);

        elements.modalMessage.textContent = message;
        elements.modalConfirmButton.textContent = confirmLabel;
        elements.modalOverlay.hidden = false;
        state.isConfirmOpen = true;
        // When a modal replaces another, focus is still inside the overlay:
        // keep the original restore target instead of the old modal's button.
        const active = document.activeElement;
        if (!active || !elements.modalOverlay.contains(active)) confirmRestoreFocus = active;

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
        window.clearTimeout(confirmHideTimer);
        confirmHideTimer = window.setTimeout(() => {
            confirmHideTimer = null;
            // A new modal opened during the exit: it owns the overlay now.
            if (state.isConfirmOpen) return;
            elements.modalOverlay.hidden = true;
            const restoreTarget = confirmRestoreFocus;
            confirmRestoreFocus = null;
            // Hiding the overlay drops focus to <body>. Only re-home it when
            // focus actually fell: a follow-up action (closing a tab) may have
            // already moved focus somewhere better, and its target may be the
            // very element this dialog was opened from — now removed.
            const focusFell = !document.activeElement || document.activeElement === document.body;
            if (focusFell && restoreTarget && restoreTarget.isConnected) restoreTarget.focus();
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

    // First H1 of the document, outside fenced code, with inline markup
    // stripped — the source for both the export title and the tab name.
    function firstHeading(markdownSource) {
        const lines = markdownSource.split(/\r?\n/);
        let fenceMarker = null;
        let fenceLength = 0;
        for (const line of lines) {
            const fence = /^\s*(`{3,}|~{3,})/.exec(line);
            if (fence) {
                if (!fenceMarker) {
                    fenceMarker = fence[1][0];
                    fenceLength = fence[1].length;
                } else if (fence[1][0] === fenceMarker && fence[1].length >= fenceLength) {
                    fenceMarker = null;
                }
                continue;
            }
            if (fenceMarker) continue;
            const heading = /^#\s+(.+?)\s*$/.exec(line);
            if (!heading) continue;
            const text = heading[1]
                .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
                .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
                .replace(/`([^`]*)`/g, "$1")
                .replace(/(\*\*|__)(.*?)\1/g, "$2")
                .replace(/~~(.*?)~~/g, "$1")
                .replace(/\*(.*?)\*/g, "$1")
                .replace(/#+\s*$/, "")
                .trim();
            if (text) return text;
        }
        return null;
    }

    function getDocumentTitle() {
        return firstHeading(elements.editor.value) || getBaseFileName();
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
        firstHeading,
        getDocumentTitle,
        downloadBlob,
        readStorage,
        writeStorage,
        loadSavedDocument,
    });
})();
