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
        App.syncScrollControls();
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

        // Language components are lazy-loaded from the local vendor folder so
        // syntax highlighting works with no network (the default points at a CDN).
        if (window.Prism?.plugins?.autoloader) {
            window.Prism.plugins.autoloader.components_path = "vendor/prism/components/";
        }
    }

    // Paper-size radios in the export menu: one checked at a time, saved for
    // the next session, applied by export.js on the next PDF.
    function bindPaperSizeMenu() {
        const items = [...document.querySelectorAll("[data-paper-size]")];

        function applySelection(key) {
            items.forEach((item) => {
                item.setAttribute("aria-checked", String(item.dataset.paperSize === key));
            });
        }

        items.forEach((item) => {
            item.addEventListener("click", () => {
                const key = item.dataset.paperSize;
                if (!App.PAGE_SIZES[key]) return;
                App.writeStorage(STORAGE_KEYS.paperSize, key);
                App.updatePageRule();
                applySelection(key);
                App.showNotice(`Paper size: ${App.PAGE_SIZES[key].label}`);
            });
        });

        applySelection(App.getPaperSizeKey());
    }

    // One implementation for every menu (header overflow + toolbar dropdowns).
    // Fixed-position menus are pinned against their trigger so the toolbar's
    // horizontal scroll container cannot clip them.
    function bindDropdown(trigger, menu, options = {}) {
        const focusTriggerOnSelect = Boolean(options.focusTriggerOnSelect);
        const scrollContainer = options.scrollContainer || null;
        let isOpen = false;

        function positionMenu() {
            // Inline offsets from a previous open are stale (the window may
            // have moved): clear them and re-measure against the CSS anchoring.
            menu.style.left = "";
            menu.style.right = "";
            menu.style.top = "";
            const isFixed = window.getComputedStyle(menu).position === "fixed";
            const triggerRect = trigger.getBoundingClientRect();
            const menuWidth = menu.offsetWidth;
            const menuHeight = menu.offsetHeight;

            if (isFixed) {
                const left = Math.min(triggerRect.left, window.innerWidth - menuWidth - 8);
                const topBelow = triggerRect.bottom + 4;
                const top = topBelow + menuHeight > window.innerHeight - 8
                    ? triggerRect.top - menuHeight - 4
                    : topBelow;
                menu.style.left = `${Math.max(8, Math.round(left))}px`;
                menu.style.top = `${Math.max(8, Math.round(top))}px`;
                return;
            }

            // Absolute menus are anchored by their CSS (right: 0 under the
            // trigger). Only nudge them when that anchoring hangs off the
            // left edge of the viewport. The closed menu is drawn at
            // scale(0.95) from its top-right corner, so recover the layout
            // box: the right edge is real, the left edge is drawn in.
            const menuRect = menu.getBoundingClientRect();
            const layoutLeft = menuRect.right - menu.offsetWidth;
            if (layoutLeft >= 8) return;
            const roomOnRight = window.innerWidth - 8 - menuRect.right;
            const shift = Math.min(8 - layoutLeft, Math.max(0, roomOnRight));
            if (shift > 0) menu.style.right = `${-Math.round(shift)}px`;
        }

        function openMenu() {
            if (isOpen) return;
            isOpen = true;
            menu.hidden = false;
            trigger.setAttribute("aria-expanded", "true");
            positionMenu();
            window.requestAnimationFrame(() => menu.classList.add("is-open"));
            const firstItem = visibleItems()[0];
            if (firstItem) firstItem.focus();
        }

        // Width-dependent items (phone-only utilities) are display:none:
        // never focus or arrow into an invisible row.
        function visibleItems() {
            return Array.from(menu.querySelectorAll(".menu-item"))
                .filter((item) => item.offsetParent !== null);
        }

        function closeMenu(returnFocus) {
            if (!isOpen) return;
            isOpen = false;
            trigger.setAttribute("aria-expanded", "false");
            menu.classList.remove("is-open");
            // Hide once the 120ms exit transition has landed; pointer-events are already off.
            const exitMs = App.reducedMotionQuery.matches ? 0 : App.EXIT_ANIMATION_MS;
            window.setTimeout(() => { if (!isOpen) menu.hidden = true; }, exitMs);
            if (returnFocus) trigger.focus();
        }

        trigger.addEventListener("click", () => {
            if (isOpen) closeMenu(true);
            else openMenu();
        });

        trigger.addEventListener("keydown", (event) => {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                openMenu();
            } else if (event.key === "Escape" && isOpen) {
                closeMenu(true);
            }
        });

        // Any activation inside the menu runs the item's own listener first (bubbling),
        // then the menu closes; toolbar menus leave focus where the action put it.
        menu.addEventListener("click", () => closeMenu(focusTriggerOnSelect));

        menu.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                closeMenu(true);
                return;
            }
            const items = visibleItems();
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

        menu.addEventListener("focusout", (event) => {
            const next = event.relatedTarget;
            if (!next) return;
            if (next === trigger || menu.contains(next)) return;
            closeMenu(false);
        });

        document.addEventListener("pointerdown", (event) => {
            if (isOpen && !menu.parentElement.contains(event.target)) closeMenu(false);
        });

        // A moved trigger leaves the menu behind: close rather than pin stale.
        if (scrollContainer) {
            scrollContainer.addEventListener("scroll", () => closeMenu(true), { passive: true });
        }
        window.addEventListener("resize", () => closeMenu(false));

        return { close: closeMenu, isOpen: () => isOpen };
    }

    // Two-column cheat sheet for the utility menu's shortcuts dialog.
    const SHORTCUTS_TEXT = [
        "Ctrl+B / Ctrl+I / Ctrl+K   Bold, italic, link",
        "Ctrl+S                     Download .md",
        "Ctrl+O                     Open file",
        "Ctrl+F                     Find",
        "Ctrl+H                     Find and replace",
        "Ctrl+Alt+T / Ctrl+Alt+W    New tab / close tab",
        "Ctrl+Alt+← / Ctrl+Alt+→    Move the active tab",
        "Enter                      Continue the current list",
        "Esc                        Close find, menu, or dialog",
    ].join("\n");

    function showKeyboardShortcuts() {
        // The answer does not matter: Cancel and Close both dismiss it.
        App.showConfirm(SHORTCUTS_TEXT, "Close");
    }

    function bindEvents() {
        elements.editor.addEventListener("input", App.handleEditorInput);
        elements.editor.addEventListener("keydown", App.handleEditorKeydown);
        elements.editor.addEventListener("scroll", () => App.syncScroll(elements.editor, elements.previewPane, "editor"));
        elements.previewPane.addEventListener("scroll", () => App.syncScroll(elements.previewPane, elements.editor, "preview"));

        elements.fileNameInput.addEventListener("change", () => {
            App.renameActiveTab(elements.fileNameInput.value);
        });

        elements.tabs.addEventListener("click", App.handleTabsClick);
        elements.tabs.addEventListener("auxclick", App.handleTabsAuxClick);
        elements.tabs.addEventListener("dblclick", App.handleTabsDoubleClick);
        elements.tabs.addEventListener("pointerdown", App.handleTabsPointerDown);
        window.addEventListener("pointermove", App.handleTabsPointerMove);
        window.addEventListener("pointerup", App.handleTabsPointerUp);
        window.addEventListener("pointercancel", App.handleTabsPointerUp);
        // A dragged pointer that leaves the window never reports a pointerup.
        window.addEventListener("blur", App.handleTabsPointerUp);
        elements.tabs.addEventListener("wheel", App.handleTabsWheel, { passive: false });
        elements.tabs.addEventListener("scroll", App.updateTabFade, { passive: true });
        // The toolbar scrolls sideways too (bar hidden): same wheel rule.
        elements.toolbar.addEventListener("wheel", App.handleTabsWheel, { passive: false });
        window.addEventListener("resize", App.updateTabFade);
        elements.newTabButton.addEventListener("click", App.createNewTab);
        document.addEventListener("keydown", App.handleTabShortcuts);
        window.addEventListener("pagehide", App.saveDocument);

        elements.viewModeButtons.forEach((button) => {
            button.addEventListener("click", () => App.setViewMode(button.dataset.viewMode));
        });

        elements.formatButtons.forEach((button) => {
            button.addEventListener("click", () => App.applyFormat(button.dataset.format));
        });

        elements.syncScrollButton.addEventListener("click", App.toggleScrollSync);
        if (elements.syncScrollMenuItem) {
            elements.syncScrollMenuItem.addEventListener("click", App.toggleScrollSync);
        }
        elements.themeButton.addEventListener("click", App.toggleTheme);
        if (elements.themeMenuItem) {
            elements.themeMenuItem.addEventListener("click", App.toggleTheme);
        }
        if (elements.shortcutsButton) {
            elements.shortcutsButton.addEventListener("click", showKeyboardShortcuts);
        }
        elements.openButton.addEventListener("click", () => elements.fileInput.click());
        if (elements.openMenuItem) {
            elements.openMenuItem.addEventListener("click", () => elements.fileInput.click());
        }
        elements.downloadButton.addEventListener("click", App.downloadMarkdown);
        elements.exportHtmlButton.addEventListener("click", App.exportHtml);
        elements.exportDocxButton.addEventListener("click", App.exportDocx);
        elements.printButton.addEventListener("click", App.printDocument);
        elements.exportPdfButton.addEventListener("click", App.exportPdf);
        if (elements.aboutButton) {
            elements.aboutButton.addEventListener("click", () => {
                window.open("https://discord.com/users/929998586375180288", "_blank", "noopener,noreferrer");
            });
        }

        bindDropdown(elements.overflowButton, elements.overflowMenu, { focusTriggerOnSelect: true });
        // Export & paper size live under the CTA's chevron, right-anchored.
        bindDropdown(elements.exportMenuButton, elements.exportMenu, { focusTriggerOnSelect: true });
        bindPaperSizeMenu();
        App.bindFindPanel();
        bindDropdown(elements.headingMenuButton, elements.headingMenu, { scrollContainer: elements.toolbar });
        bindDropdown(elements.listsMenuButton, elements.listsMenu, { scrollContainer: elements.toolbar });
        bindDropdown(elements.insertMenuButton, elements.insertMenu, { scrollContainer: elements.toolbar });
        bindDropdown(elements.mathMenuButton, elements.mathMenu, { scrollContainer: elements.toolbar });

        // The heading trigger mirrors the caret's block level (H1..H4 or P).
        elements.editor.addEventListener("input", App.updateTextLevelIndicator);
        document.addEventListener("selectionchange", () => {
            if (document.activeElement === elements.editor) App.updateTextLevelIndicator();
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

        elements.modalCancelButton.addEventListener("click", () => App.closeConfirm(false));
        elements.modalConfirmButton.addEventListener("click", () => App.closeConfirm(true));
        elements.modalOverlay.addEventListener("click", (event) => {
            if (event.target === elements.modalOverlay) App.closeConfirm(false);
        });
        // Escape and the Tab trap run at the document: focus can sit anywhere
        // once the dialog has been interacted with, not just inside the overlay.
        document.addEventListener("keydown", (event) => {
            if (!state.isConfirmOpen) return;
            if (event.key === "Escape") {
                event.stopPropagation();
                App.closeConfirm(false);
                return;
            }
            if (event.key !== "Tab") return;
            // Two-button focus trap: Tab wraps between Cancel and Confirm,
            // and pulls focus back if a click dropped it outside the dialog.
            const first = elements.modalCancelButton;
            const last = elements.modalConfirmButton;
            if (!elements.modalOverlay.contains(document.activeElement)) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });

        elements.workspace.addEventListener("dragover", App.handleDragOver);
        elements.workspace.addEventListener("dragleave", App.handleDragLeave);
        elements.workspace.addEventListener("drop", App.handleDrop);

        // A file dropped outside the workspace would make the browser navigate
        // away from the app entirely: cancel that default here. Drops inside
        // the workspace are handled above and open the file as usual.
        document.addEventListener("dragover", (event) => {
            if (!event.dataTransfer?.types.includes("Files")) return;
            event.preventDefault();
        });
        document.addEventListener("drop", (event) => {
            if (!event.dataTransfer?.files.length) return;
            event.preventDefault();
        });

        // Tab widths depend on the loaded UI font: re-check the edge fades
        // once it has settled.
        if (document.fonts?.ready) {
            document.fonts.ready.then(() => App.updateTabFade());
        }

        narrowScreenQuery.addEventListener("change", App.applyViewMode);
        // Crossing 640px folds split in/out of the two-way phone toggle.
        App.phoneQuery.addEventListener("change", App.applyViewMode);
        document.addEventListener("keydown", App.handleGlobalKeydown);
        window.addEventListener("beforeprint", App.handleBeforePrint);
        window.addEventListener("afterprint", App.handleAfterPrint);
    }

    function initialize() {
        configureLibraries();
        restoreInterfacePreferences();
        bindEvents();

        const wasRestored = App.loadTabs();
        App.renderTabs();

        elements.fileNameInput.value = state.fileName;
        App.updateTextLevelIndicator();
        App.renderPreview();
        App.restorePreviewScroll();
        elements.saveStatus.textContent = wasRestored ? "Restored from this browser" : "Not saved yet";
    }

    initialize();
})();
