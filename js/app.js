(() => {
    "use strict";

    const { state, elements, narrowScreenQuery, STORAGE_KEYS, VIEW_MODES } = App;

    function restoreInterfacePreferences() {
        App.applyTheme(App.readStorage(STORAGE_KEYS.theme) === "light" ? "light" : "dark");

        const savedViewMode = App.readStorage(STORAGE_KEYS.viewMode);
        if (VIEW_MODES.includes(savedViewMode)) state.viewMode = savedViewMode;
        App.applyViewMode();

        const savedSplitPercent = Number(App.readStorage(STORAGE_KEYS.splitPercent));
        App.applySplitPercent(Number.isFinite(savedSplitPercent) && savedSplitPercent > 0 ? savedSplitPercent : 50);

        state.isScrollSyncEnabled = App.readStorage(STORAGE_KEYS.syncScroll) !== "false";
        elements.syncScrollButton.setAttribute("aria-pressed", String(state.isScrollSyncEnabled));
    }

    function configureLibraries() {
        if (window.marked) window.marked.use({ gfm: true, breaks: false });

        if (window.DOMPurify) {
            window.DOMPurify.addHook("afterSanitizeAttributes", (node) => {
                if (node.tagName === "A" && node.hasAttribute("href")) {
                    node.setAttribute("target", "_blank");
                    node.setAttribute("rel", "noopener noreferrer");
                }
            });
        }
    }

    let isOverflowMenuOpen = false;

    function openOverflowMenu() {
        if (isOverflowMenuOpen) return;
        isOverflowMenuOpen = true;
        elements.overflowMenu.hidden = false;
        elements.overflowButton.setAttribute("aria-expanded", "true");
        window.requestAnimationFrame(() => elements.overflowMenu.classList.add("is-open"));
        const firstItem = elements.overflowMenu.querySelector(".menu-item");
        if (firstItem) firstItem.focus();
    }

    function closeOverflowMenu(returnFocus) {
        if (!isOverflowMenuOpen) return;
        isOverflowMenuOpen = false;
        elements.overflowButton.setAttribute("aria-expanded", "false");
        elements.overflowMenu.classList.remove("is-open");
        // Hide once the 150ms close transition has finished; pointer-events are already off.
        window.setTimeout(() => { if (!isOverflowMenuOpen) elements.overflowMenu.hidden = true; }, 150);
        if (returnFocus) elements.overflowButton.focus();
    }

    function bindEvents() {
        elements.editor.addEventListener("input", App.handleEditorInput);
        elements.editor.addEventListener("keydown", App.handleEditorKeydown);
        elements.editor.addEventListener("scroll", () => App.syncScroll(elements.editor, elements.previewPane, "editor"));
        elements.previewPane.addEventListener("scroll", () => App.syncScroll(elements.previewPane, elements.editor, "preview"));

        elements.fileNameInput.addEventListener("change", () => {
            state.fileName = App.ensureMarkdownExtension(elements.fileNameInput.value);
            elements.fileNameInput.value = state.fileName;
            App.scheduleAutosave();
        });

        elements.viewModeButtons.forEach((button) => {
            button.addEventListener("click", () => App.setViewMode(button.dataset.viewMode));
        });

        elements.formatButtons.forEach((button) => {
            button.addEventListener("click", () => App.applyFormat(button.dataset.format));
        });

        elements.syncScrollButton.addEventListener("click", App.toggleScrollSync);
        elements.themeButton.addEventListener("click", App.toggleTheme);
        elements.newButton.addEventListener("click", App.createNewDocument);
        elements.openButton.addEventListener("click", () => elements.fileInput.click());
        elements.downloadButton.addEventListener("click", App.downloadMarkdown);
        elements.exportHtmlButton.addEventListener("click", App.exportHtml);
        elements.printButton.addEventListener("click", App.printDocument);
        elements.exportPdfButton.addEventListener("click", App.exportPdf);

        elements.overflowButton.addEventListener("click", () => {
            if (isOverflowMenuOpen) closeOverflowMenu(true);
            else openOverflowMenu();
        });

        elements.overflowButton.addEventListener("keydown", (event) => {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                openOverflowMenu();
            } else if (event.key === "Escape" && isOverflowMenuOpen) {
                closeOverflowMenu(true);
            }
        });

        // Any activation inside the menu runs the item's own listener first (bubbling),
        // then the menu closes and hands focus back to the trigger.
        elements.overflowMenu.addEventListener("click", () => closeOverflowMenu(true));

        elements.overflowMenu.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                closeOverflowMenu(true);
                return;
            }
            const items = Array.from(elements.overflowMenu.querySelectorAll(".menu-item"));
            if (items.length === 0) return;
            const index = items.indexOf(document.activeElement);
            if (event.key === "ArrowDown") {
                event.preventDefault();
                items[(index + 1) % items.length].focus();
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                items[(index - 1 + items.length) % items.length].focus();
            } else if (event.key === "Home") {
                event.preventDefault();
                items[0].focus();
            } else if (event.key === "End") {
                event.preventDefault();
                items[items.length - 1].focus();
            }
        });

        elements.overflowMenu.addEventListener("focusout", (event) => {
            const next = event.relatedTarget;
            if (!next) return;
            if (next === elements.overflowButton || elements.overflowMenu.contains(next)) return;
            closeOverflowMenu(false);
        });

        document.addEventListener("pointerdown", (event) => {
            if (isOverflowMenuOpen && !elements.overflowMenu.parentElement.contains(event.target)) {
                closeOverflowMenu(false);
            }
        });

        elements.fileInput.addEventListener("change", () => {
            App.openFile(elements.fileInput.files[0]);
            elements.fileInput.value = "";
        });

        elements.divider.addEventListener("pointerdown", App.startDividerDrag);
        elements.divider.addEventListener("pointermove", App.moveDivider);
        elements.divider.addEventListener("pointerup", App.endDividerDrag);
        elements.divider.addEventListener("pointercancel", App.endDividerDrag);
        elements.divider.addEventListener("keydown", App.handleDividerKeydown);

        elements.workspace.addEventListener("dragover", App.handleDragOver);
        elements.workspace.addEventListener("dragleave", App.handleDragLeave);
        elements.workspace.addEventListener("drop", App.handleDrop);

        narrowScreenQuery.addEventListener("change", App.applyViewMode);
        document.addEventListener("keydown", App.handleGlobalKeydown);
        window.addEventListener("beforeprint", App.handleBeforePrint);
        window.addEventListener("afterprint", App.handleAfterPrint);
    }

    function initialize() {
        configureLibraries();
        restoreInterfacePreferences();
        bindEvents();

        const savedDocument = App.loadSavedDocument();
        if (savedDocument) {
            elements.editor.value = savedDocument.content;
            state.fileName = App.ensureMarkdownExtension(savedDocument.fileName || "untitled.md");
        } else {
            elements.editor.value = elements.sampleDocument.textContent.trim();
        }

        elements.fileNameInput.value = state.fileName;
        App.renderPreview();
        elements.saveStatus.textContent = savedDocument ? "Restored from this browser" : "Not saved yet";
    }

    initialize();
})();
