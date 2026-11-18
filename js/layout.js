(() => {
    "use strict";

    const {
        state,
        elements,
        narrowScreenQuery,
        phoneQuery,
        STORAGE_KEYS,
        VIEW_MODES,
        MIN_SPLIT_PERCENT,
        MAX_SPLIT_PERCENT,
        DIVIDER_KEY_STEP_PERCENT,
    } = App;

    // The split stacks editor over preview on narrow screens.
    function isStackedSplit() {
        return narrowScreenQuery.matches && getEffectiveViewMode() === "split";
    }

    function getEffectiveViewMode() {
        // Phones (<640px) offer a two-way Edit|Preview toggle: split folds to
        // edit there. state.viewMode keeps "split" so wider screens restore it.
        if (phoneQuery.matches && state.viewMode === "split") return "edit";
        // Otherwise split stays split — on phones it stacks vertically.
        return state.viewMode;
    }

    // Scroll sync only means something side by side: dim it elsewhere.
    function updateSplitDependentControls() {
        const canSync = getEffectiveViewMode() === "split";
        elements.syncScrollButton.disabled = !canSync;
        elements.syncScrollButton.title = canSync ? "Sync scroll" : "Sync scroll — split view only";
        if (elements.syncScrollMenuItem) elements.syncScrollMenuItem.disabled = !canSync;
    }

    // The toolbar button and the phone's utility-menu item mirror one state.
    function syncScrollControls() {
        const enabled = String(state.isScrollSyncEnabled);
        elements.syncScrollButton.setAttribute("aria-pressed", enabled);
        if (elements.syncScrollMenuItem) {
            elements.syncScrollMenuItem.setAttribute("aria-checked", enabled);
        }
    }

    let hasAppliedViewMode = false;

    function applyViewMode() {
        const effectiveMode = getEffectiveViewMode();
        const didChange = elements.workspace.dataset.view !== effectiveMode;
        elements.workspace.dataset.view = effectiveMode;
        syncDividerOrientation();
        updateSplitDependentControls();

        elements.viewModeButtons.forEach((button) => {
            button.setAttribute("aria-pressed", String(button.dataset.viewMode === effectiveMode));
        });

        // The first run is the boot: the initial layout appears without animation
        // (slop #84/#90). Later changes crossfade the panes in.
        if (hasAppliedViewMode && didChange) {
            App.replayClass(elements.workspace, "is-swapping");
        }
        hasAppliedViewMode = true;
    }

    function setViewMode(viewMode) {
        if (!VIEW_MODES.includes(viewMode)) return;
        state.viewMode = viewMode;
        App.writeStorage(STORAGE_KEYS.viewMode, viewMode);
        applyViewMode();
    }

    function applySplitPercent(splitPercent) {
        const clampedPercent = App.clamp(splitPercent, MIN_SPLIT_PERCENT, MAX_SPLIT_PERCENT);
        elements.workspace.style.setProperty("--split-percent", `${clampedPercent}%`);
        elements.divider.setAttribute("aria-valuenow", String(Math.round(clampedPercent)));
        return clampedPercent;
    }

    function startDividerDrag(event) {
        // Only the primary button drags; a right-click must stay a context menu.
        if (event.button !== 0 && event.pointerType !== "touch") return;
        elements.divider.setPointerCapture(event.pointerId);
        elements.divider.classList.add("is-dragging");
    }

    function moveDivider(event) {
        if (!elements.divider.hasPointerCapture(event.pointerId)) return;
        const workspaceBounds = elements.workspace.getBoundingClientRect();
        // Stacked (phone) split drags vertically; wide split drags horizontally.
        const stacked = isStackedSplit();
        const pointerPercent = stacked
            ? ((event.clientY - workspaceBounds.top) / workspaceBounds.height) * 100
            : ((event.clientX - workspaceBounds.left) / workspaceBounds.width) * 100;
        applySplitPercent(pointerPercent);
    }

    function endDividerDrag(event) {
        if (!elements.divider.hasPointerCapture(event.pointerId)) return;
        elements.divider.releasePointerCapture(event.pointerId);
        elements.divider.classList.remove("is-dragging");
        App.writeStorage(STORAGE_KEYS.splitPercent, elements.divider.getAttribute("aria-valuenow"));
    }

    function handleDividerKeydown(event) {
        const currentPercent = Number(elements.divider.getAttribute("aria-valuenow"));
        const stacked = isStackedSplit();
        const decreaseKey = stacked ? "ArrowUp" : "ArrowLeft";
        const increaseKey = stacked ? "ArrowDown" : "ArrowRight";
        let nextPercent = null;

        if (event.key === decreaseKey) nextPercent = currentPercent - DIVIDER_KEY_STEP_PERCENT;
        if (event.key === increaseKey) nextPercent = currentPercent + DIVIDER_KEY_STEP_PERCENT;
        if (nextPercent === null) return;

        event.preventDefault();
        const appliedPercent = applySplitPercent(nextPercent);
        App.writeStorage(STORAGE_KEYS.splitPercent, String(appliedPercent));
    }

    // The divider flips between col-resize (wide) and row-resize (stacked):
    // keep aria in step so assistive tech announces the right axis.
    function syncDividerOrientation() {
        elements.divider.setAttribute("aria-orientation", isStackedSplit() ? "horizontal" : "vertical");
    }

    function syncScroll(sourceElement, targetElement, sourceName) {
        if (!state.isScrollSyncEnabled || elements.workspace.dataset.view !== "split") return;
        if (state.scrollSource && state.scrollSource !== sourceName) return;

        const sourceRange = sourceElement.scrollHeight - sourceElement.clientHeight;
        const targetRange = targetElement.scrollHeight - targetElement.clientHeight;
        if (sourceRange <= 0 || targetRange <= 0) return;

        state.scrollSource = sourceName;
        targetElement.scrollTop = (sourceElement.scrollTop / sourceRange) * targetRange;
        window.requestAnimationFrame(() => { state.scrollSource = null; });
    }

    function toggleScrollSync() {
        state.isScrollSyncEnabled = !state.isScrollSyncEnabled;
        syncScrollControls();
        App.writeStorage(STORAGE_KEYS.syncScroll, String(state.isScrollSyncEnabled));
    }

    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        const label = theme === "dark" ? "Light theme" : "Dark theme";
        const iconName = theme === "dark" ? "sun" : "moon";
        App.setButtonIcon(elements.themeButton, iconName);
        elements.themeButton.setAttribute("aria-label", label);
        elements.themeButton.title = label;
        const labelNode = elements.themeButton.querySelector(".button-label");
        if (labelNode) labelNode.textContent = label;
        // The phone's utility menu mirrors the toggle (the button hides <768px).
        if (elements.themeMenuItem) {
            App.setButtonIcon(elements.themeMenuItem, iconName);
            elements.themeMenuItem.title = label;
            const menuLabel = elements.themeMenuItem.querySelector(".menu-label");
            if (menuLabel) menuLabel.textContent = label;
        }
    }

    function toggleTheme() {
        const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";

        // Crossfade: hold the transition class on <html>, reflow once so the
        // transition has a start state, then swap the tokens. Reduced motion
        // keeps instant swaps (the CSS block is scoped to no-preference).
        window.clearTimeout(state.themeSwapTimer);
        document.documentElement.classList.remove("theme-swap");
        void document.documentElement.offsetWidth;
        document.documentElement.classList.add("theme-swap");
        state.themeSwapTimer = window.setTimeout(() => {
            document.documentElement.classList.remove("theme-swap");
        }, App.THEME_SWAP_MS);

        applyTheme(nextTheme);
        App.replayClass(elements.themeButton, "is-icon-swap");
        App.writeStorage(STORAGE_KEYS.theme, nextTheme);
    }

    function handleDragOver(event) {
        if (!event.dataTransfer?.types.includes("Files")) return;
        event.preventDefault();
        elements.workspace.classList.add("is-dropping");
    }

    function handleDragLeave(event) {
        // Moving between panes fires dragleave on the way through: only a
        // pointer that actually left the workspace clears the highlight.
        if (event.relatedTarget && elements.workspace.contains(event.relatedTarget)) return;
        elements.workspace.classList.remove("is-dropping");
    }

    function handleDrop(event) {
        const files = event.dataTransfer?.files;
        if (!files || !files.length) return;
        event.preventDefault();
        elements.workspace.classList.remove("is-dropping");
        if (files.length > 1) {
            App.showNotice("This app opens one file per drop — the extra files were ignored.");
        }
        App.openFile(files[0]);
    }

    Object.assign(App, {
        getEffectiveViewMode,
        isStackedSplit,
        applyViewMode,
        setViewMode,
        applySplitPercent,
        startDividerDrag,
        moveDivider,
        endDividerDrag,
        handleDividerKeydown,
        syncDividerOrientation,
        syncScrollControls,
        updateSplitDependentControls,
        syncScroll,
        toggleScrollSync,
        applyTheme,
        toggleTheme,
        handleDragOver,
        handleDragLeave,
        handleDrop,
    });
})();
