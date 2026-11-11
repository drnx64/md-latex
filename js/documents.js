(() => {
    "use strict";

    const { state, elements, STORAGE_KEYS, AUTOSAVE_DELAY_MS, MAX_OPEN_FILE_BYTES } = App;

    let tabSequence = 0;

    function createTab(fileName, content) {
        tabSequence += 1;
        return {
            id: `tab-${Date.now().toString(36)}-${tabSequence}`,
            fileName: App.ensureMarkdownExtension(fileName),
            content,
            selectionStart: 0,
            selectionEnd: 0,
            editorScrollTop: 0,
            previewScrollTop: 0,
        };
    }

    function getActiveTab() {
        return state.tabs.find((tab) => tab.id === state.activeTabId) || null;
    }

    // Editor state flows into the tab object on every switch and every save.
    function captureTabState(tab) {
        if (!tab) return;
        tab.content = elements.editor.value;
        tab.fileName = state.fileName;
        tab.selectionStart = elements.editor.selectionStart;
        tab.selectionEnd = elements.editor.selectionEnd;
        tab.editorScrollTop = elements.editor.scrollTop;
        tab.previewScrollTop = elements.previewPane.scrollTop;
    }

    function loadTabIntoEditor(tab) {
        elements.editor.value = tab.content;
        state.fileName = tab.fileName;
        elements.fileNameInput.value = tab.fileName;

        const caretStart = Math.min(tab.selectionStart, tab.content.length);
        const caretEnd = Math.min(Math.max(tab.selectionEnd, caretStart), tab.content.length);
        elements.editor.setSelectionRange(caretStart, caretEnd);
        elements.editor.scrollTop = tab.editorScrollTop;
    }

    function restorePreviewScroll() {
        const tab = getActiveTab();
        elements.previewPane.scrollTop = tab ? tab.previewScrollTop : 0;
    }

    function renderTabs() {
        const container = elements.tabs;
        container.textContent = "";

        state.tabs.forEach((tab) => {
            const isActive = tab.id === state.activeTabId;
            const wrapper = document.createElement("div");
            wrapper.className = isActive ? "tab is-active" : "tab";
            wrapper.dataset.tabId = tab.id;

            const tabButton = document.createElement("button");
            tabButton.type = "button";
            tabButton.className = "tab-button";
            tabButton.dataset.tabId = tab.id;
            tabButton.textContent = tab.fileName;
            tabButton.title = `${tab.fileName} (double-click to rename)`;
            if (isActive) tabButton.setAttribute("aria-current", "true");
            wrapper.appendChild(tabButton);

            const closeButton = document.createElement("button");
            closeButton.type = "button";
            closeButton.className = "tab-close";
            closeButton.dataset.tabId = tab.id;
            closeButton.dataset.icon = "close";
            closeButton.title = "Close tab";
            closeButton.setAttribute("aria-label", `Close ${tab.fileName}`);
            wrapper.appendChild(closeButton);

            container.appendChild(wrapper);
        });

        App.renderIcons(container);

        const activeButton = container.querySelector(".tab.is-active .tab-button");
        if (activeButton) activeButton.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    function activateTab(tabId) {
        if (tabId === state.activeTabId) return;
        const nextTab = state.tabs.find((tab) => tab.id === tabId);
        if (!nextTab) return;

        captureTabState(getActiveTab());
        state.activeTabId = tabId;
        loadTabIntoEditor(nextTab);

        App.renderPreview();
        restorePreviewScroll();
        App.updateTextLevelIndicator();
        renderTabs();
        App.replayClass(elements.workspace, "is-swapping");
        App.scheduleAutosave();
    }

    function nextUntitledName() {
        const takenNames = new Set(state.tabs.map((tab) => tab.fileName.toLowerCase()));
        if (!takenNames.has("untitled.md")) return "untitled.md";
        let suffix = 2;
        while (takenNames.has(`untitled ${suffix}.md`)) suffix += 1;
        return `untitled ${suffix}.md`;
    }

    function createNewTab() {
        captureTabState(getActiveTab());
        const tab = createTab(nextUntitledName(), "");
        state.tabs.push(tab);
        state.activeTabId = tab.id;
        loadTabIntoEditor(tab);

        App.renderPreview();
        restorePreviewScroll();
        App.updateTextLevelIndicator();
        renderTabs();
        App.replayClass(elements.workspace, "is-swapping");

        // The newest tab grows in from nothing.
        const tabElement = elements.tabs.querySelector(`.tab[data-tab-id="${tab.id}"]`);
        if (tabElement) tabElement.classList.add("is-entering");

        App.scheduleAutosave();
        elements.editor.focus();
    }

    async function closeTab(tabId) {
        const tab = state.tabs.find((entry) => entry.id === tabId);
        if (!tab) return;

        const isActive = tab.id === state.activeTabId;
        const content = isActive ? elements.editor.value : tab.content;

        // Chrome closes instantly; here the browser copy is the only copy,
        // so a tab with text in it asks first. Empty tabs close on the spot.
        if (content.trim() !== "") {
            const confirmed = await App.showConfirm(
                `Close "${tab.fileName}"? Its text will be removed from this browser.`,
                "Close",
            );
            if (!confirmed) return;
        }

        // Re-lookup after the await: the strip may have changed underneath.
        const index = state.tabs.findIndex((entry) => entry.id === tabId);
        if (index === -1) return;

        const focusWasInTabs = elements.tabs.contains(document.activeElement);
        const tabElement = elements.tabs.querySelector(`.tab[data-tab-id="${tabId}"]`);
        const exitMs = App.reducedMotionQuery.matches ? 0 : App.EXIT_ANIMATION_MS;

        if (isActive) captureTabState(tab);
        state.tabs.splice(index, 1);

        if (state.tabs.length === 0) {
            const freshTab = createTab("untitled.md", "");
            state.tabs.push(freshTab);
            state.activeTabId = freshTab.id;
        } else if (isActive) {
            state.activeTabId = state.tabs[Math.min(index, state.tabs.length - 1)].id;
        }

        // Only an active-tab close swaps the editor's contents; a background
        // close leaves the active document alone in the editor.
        if (isActive) {
            const visibleTab = getActiveTab();
            loadTabIntoEditor(visibleTab);
            App.renderPreview();
            restorePreviewScroll();
            App.updateTextLevelIndicator();
        }

        renderTabs();
        App.scheduleAutosave();

        if (focusWasInTabs) {
            const focusId = isActive
                ? state.activeTabId
                : (state.tabs[Math.min(index, state.tabs.length - 1)] || getActiveTab()).id;
            const focusTarget = elements.tabs.querySelector(`.tab-button[data-tab-id="${focusId}"]`);
            if (focusTarget) focusTarget.focus();
        }

        // renderTabs rebuilt the strip, so the closing entry outlives the
        // rebuild: re-insert it in place and let it collapse out of the row.
        if (tabElement && exitMs > 0) {
            tabElement.classList.remove("is-active");
            const anchor = elements.tabs.children[index] || null;
            elements.tabs.insertBefore(tabElement, anchor);
            tabElement.style.setProperty("--tab-out-width", `${tabElement.offsetWidth}px`);
            tabElement.classList.add("is-leaving");
            window.setTimeout(() => tabElement.remove(), exitMs);
        }
    }

    function cycleTab(direction) {
        if (state.tabs.length < 2) return;
        const currentIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
        const nextIndex = (currentIndex + direction + state.tabs.length) % state.tabs.length;
        activateTab(state.tabs[nextIndex].id);

        const button = elements.tabs.querySelector(`.tab-button[data-tab-id="${state.activeTabId}"]`);
        if (button) button.focus();
    }

    function renameActiveTab(rawFileName) {
        const fileName = App.ensureMarkdownExtension(rawFileName);
        elements.fileNameInput.value = fileName;
        state.fileName = fileName;

        const activeTab = getActiveTab();
        if (activeTab) activeTab.fileName = fileName;

        renderTabs();
        App.scheduleAutosave();
    }

    function handleTabsClick(event) {
        const closeButton = event.target.closest(".tab-close");
        if (closeButton) {
            closeTab(closeButton.dataset.tabId);
            return;
        }
        const tabButton = event.target.closest(".tab-button");
        if (tabButton) activateTab(tabButton.dataset.tabId);
    }

    function handleTabsAuxClick(event) {
        if (event.button !== 1) return;
        const tabButton = event.target.closest(".tab-button");
        if (!tabButton) return;
        event.preventDefault();
        closeTab(tabButton.dataset.tabId);
    }

    function handleTabsDoubleClick(event) {
        if (!event.target.closest(".tab-button")) return;
        elements.fileNameInput.focus();
        elements.fileNameInput.select();
    }

    function handleTabShortcuts(event) {
        if (event.isComposing || state.isConfirmOpen) return;
        const hasModifier = event.ctrlKey || event.metaKey;
        if (!hasModifier) return;

        const key = event.key.toLowerCase();
        if (event.altKey && key === "t") {
            event.preventDefault();
            createNewTab();
        } else if (event.altKey && key === "w") {
            event.preventDefault();
            closeTab(state.activeTabId);
        } else if (key === "tab" && state.tabs.length > 1) {
            event.preventDefault();
            cycleTab(event.shiftKey ? -1 : 1);
        }
    }

    function saveDocument() {
        captureTabState(getActiveTab());

        const wasSaved = App.writeStorage(STORAGE_KEYS.tabs, JSON.stringify({
            tabs: state.tabs,
            activeTabId: state.activeTabId,
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

    function normalizeTab(rawTab) {
        if (!rawTab || typeof rawTab !== "object" || typeof rawTab.content !== "string") return null;

        const contentLength = rawTab.content.length;
        const toOffset = (value, fallback) => (Number.isFinite(value) && value >= 0
            ? Math.min(Math.floor(value), contentLength)
            : fallback);
        const toScroll = (value) => (Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

        const tab = createTab(typeof rawTab.fileName === "string" ? rawTab.fileName : "", rawTab.content);
        tab.selectionStart = toOffset(rawTab.selectionStart, 0);
        tab.selectionEnd = toOffset(rawTab.selectionEnd, tab.selectionStart);
        tab.editorScrollTop = toScroll(rawTab.editorScrollTop);
        tab.previewScrollTop = toScroll(rawTab.previewScrollTop);
        return tab;
    }

    // Restores the stored tab strip (or migrates the legacy single-document
    // key, or falls back to the sample) and loads the active tab.
    function loadTabs() {
        let restoredTabs = null;
        let restoredActiveId = null;

        const rawStoredTabs = App.readStorage(STORAGE_KEYS.tabs);
        if (rawStoredTabs) {
            try {
                const parsed = JSON.parse(rawStoredTabs);
                if (Array.isArray(parsed?.tabs)) {
                    const normalizedTabs = [];
                    parsed.tabs.forEach((rawTab) => {
                        const tab = normalizeTab(rawTab);
                        if (!tab) return;
                        if (rawTab && rawTab.id === parsed.activeTabId) restoredActiveId = tab.id;
                        normalizedTabs.push(tab);
                    });
                    if (normalizedTabs.length > 0) restoredTabs = normalizedTabs;
                }
            } catch (error) {
                restoredTabs = null;
            }
        }

        if (!restoredTabs) {
            const legacyDocument = App.loadSavedDocument();
            if (legacyDocument && typeof legacyDocument.content === "string") {
                restoredTabs = [createTab(legacyDocument.fileName || "", legacyDocument.content)];
            }
        }

        const wasRestored = Boolean(restoredTabs);

        if (!restoredTabs) {
            const sample = elements.sampleDocument ? elements.sampleDocument.textContent.trim() : "";
            restoredTabs = [createTab("untitled.md", sample)];
        }

        state.tabs = restoredTabs;
        state.activeTabId = restoredActiveId && restoredTabs.some((tab) => tab.id === restoredActiveId)
            ? restoredActiveId
            : restoredTabs[0].id;
        loadTabIntoEditor(getActiveTab());

        return wasRestored;
    }

    function setDocument(content, fileName) {
        elements.editor.value = content;
        state.fileName = fileName;
        elements.fileNameInput.value = fileName;

        const activeTab = getActiveTab();
        if (activeTab) {
            activeTab.content = content;
            activeTab.fileName = fileName;
            activeTab.selectionStart = 0;
            activeTab.selectionEnd = 0;
            activeTab.editorScrollTop = 0;
            activeTab.previewScrollTop = 0;
        }

        App.renderPreview();
        elements.editor.scrollTop = 0;
        elements.previewPane.scrollTop = 0;
        App.updateTextLevelIndicator();
        renderTabs();
        saveDocument();
    }

    async function confirmReplaceDocument() {
        if (elements.editor.value.trim() === "") return true;
        return App.showConfirm(
            "Replace the current document? The current text will be overwritten.",
            "Replace",
        );
    }

    async function createNewDocument() {
        if (!(await confirmReplaceDocument())) return;
        setDocument("", "untitled.md");
        elements.editor.focus();
    }

    async function openFile(file) {
        if (!file) return;
        if (file.size > MAX_OPEN_FILE_BYTES) {
            App.showNotice("That file is larger than 5 MB.", true);
            return;
        }
        if (!(await confirmReplaceDocument())) return;

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
        saveDocument,
        handleEditorInput,
        createNewDocument,
        openFile,
        downloadMarkdown,
        loadTabs,
        renderTabs,
        restorePreviewScroll,
        renameActiveTab,
        createNewTab,
        handleTabsClick,
        handleTabsAuxClick,
        handleTabsDoubleClick,
        handleTabShortcuts,
    });
})();
