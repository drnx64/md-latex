(() => {
    "use strict";

    const { state, elements, STORAGE_KEYS, AUTOSAVE_DELAY_MS, MAX_OPEN_FILE_BYTES } = App;

    function saveDocument() {
        const wasSaved = App.writeStorage(STORAGE_KEYS.document, JSON.stringify({
            content: elements.editor.value,
            fileName: state.fileName,
            savedAt: Date.now(),
        }));

        elements.saveStatus.textContent = wasSaved
            ? `Saved at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Not saved: browser storage is unavailable";
    }

    function scheduleAutosave() {
        elements.saveStatus.textContent = "Saving...";
        window.clearTimeout(state.autosaveTimer);
        state.autosaveTimer = window.setTimeout(saveDocument, AUTOSAVE_DELAY_MS);
    }

    function handleEditorInput() {
        App.scheduleRender();
        scheduleAutosave();
    }

    function setDocument(content, fileName) {
        elements.editor.value = content;
        state.fileName = fileName;
        elements.fileNameInput.value = fileName;
        App.renderPreview();
        saveDocument();
        elements.editor.scrollTop = 0;
        elements.previewPane.scrollTop = 0;
    }

    function confirmReplaceDocument() {
        if (elements.editor.value.trim() === "") return true;
        return window.confirm("Replace the current document? The current text will be overwritten.");
    }

    function createNewDocument() {
        if (!confirmReplaceDocument()) return;
        setDocument("", "untitled.md");
        elements.editor.focus();
    }

    async function openFile(file) {
        if (!file) return;
        if (file.size > MAX_OPEN_FILE_BYTES) {
            App.showNotice("That file is larger than 5 MB.", true);
            return;
        }
        if (!confirmReplaceDocument()) return;

        try {
            const fileText = await file.text();
            setDocument(fileText, file.name);
            App.showNotice(`Opened ${file.name}`);
        } catch (error) {
            App.showNotice("Could not read that file.", true);
        }
    }

    function downloadMarkdown() {
        const downloadName = App.ensureMarkdownExtension(state.fileName);
        const markdownBlob = new Blob([elements.editor.value], { type: "text/markdown;charset=utf-8" });
        App.downloadBlob(markdownBlob, downloadName);
    }

    Object.assign(App, {
        scheduleAutosave,
        handleEditorInput,
        createNewDocument,
        openFile,
        downloadMarkdown,
    });
})();
