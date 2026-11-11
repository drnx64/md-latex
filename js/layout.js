(() => {
    "use strict";

    const {
        state,
        elements,
        narrowScreenQuery,
        STORAGE_KEYS,
        VIEW_MODES,
        MIN_SPLIT_PERCENT,
        MAX_SPLIT_PERCENT,
        DIVIDER_KEY_STEP_PERCENT,
    } = App;

    function getEffectiveViewMode() {
        return narrowScreenQuery.matches && state.viewMode === "split" ? "edit" : state.viewMode;
    }

    let hasAppliedViewMode = false;

    function applyViewMode() {
        const effectiveMode = getEffectiveViewMode();
        const didChange = elements.workspace.dataset.view !== effectiveMode;
        elements.workspace.dataset.view = effectiveMode;

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
        elements.divider.setPointerCapture(event.pointerId);
        elements.divider.classList.add("is-dragging");
    }

    function moveDivider(event) {
        if (!elements.divider.hasPointerCapture(event.pointerId)) return;
        const workspaceBounds = elements.workspace.getBoundingClientRect();
        const pointerPercent = ((event.clientX - workspaceBounds.left) / workspaceBounds.width) * 100;
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
        let nextPercent = null;

        if (event.key === "ArrowLeft") nextPercent = currentPercent - DIVIDER_KEY_STEP_PERCENT;
        if (event.key === "ArrowRight") nextPercent = currentPercent + DIVIDER_KEY_STEP_PERCENT;
        if (nextPercent === null) return;

        event.preventDefault();
        const appliedPercent = applySplitPercent(nextPercent);
        App.writeStorage(STORAGE_KEYS.splitPercent, String(appliedPercent));
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
        elements.syncScrollButton.setAttribute("aria-pressed", String(state.isScrollSyncEnabled));
        App.writeStorage(STORAGE_KEYS.syncScroll, String(state.isScrollSyncEnabled));
    }

    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;
        const label = theme === "dark" ? "Light theme" : "Dark theme";
        App.setButtonIcon(elements.themeButton, theme === "dark" ? "sun" : "moon");
        elements.themeButton.setAttribute("aria-label", label);
        elements.themeButton.title = label;
        const labelNode = elements.themeButton.querySelector(".button-label");
        if (labelNode) labelNode.textContent = label;
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

    function handleDragLeave() {
        elements.workspace.classList.remove("is-dropping");
    }

    function handleDrop(event) {
        if (!event.dataTransfer?.files.length) return;
        event.preventDefault();
        elements.workspace.classList.remove("is-dropping");
        App.openFile(event.dataTransfer.files[0]);
    }

    Object.assign(App, {
        applyViewMode,
        setViewMode,
        applySplitPercent,
        startDividerDrag,
        moveDivider,
        endDividerDrag,
        handleDividerKeydown,
        syncScroll,
        toggleScrollSync,
        applyTheme,
        toggleTheme,
        handleDragOver,
        handleDragLeave,
        handleDrop,
    });
})();
