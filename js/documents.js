(() => {
    "use strict";

    const { state, elements, STORAGE_KEYS, AUTOSAVE_DELAY_MS, MAX_OPEN_FILE_BYTES } = App;

    let tabSequence = 0;

    // Names the app generates itself: a tab with one of these follows the
    // document's first H1 until the user renames it to something else.
    const AUTO_TITLE_NAME_PATTERN = /^untitled(\s*\d+)?\.md$/i;

    function isAutoTitleName(fileName) {
        return AUTO_TITLE_NAME_PATTERN.test(fileName);
    }

    function createTab(fileName, content) {
        tabSequence += 1;
        const normalized = App.ensureMarkdownExtension(fileName);
        return {
            id: `tab-${Date.now().toString(36)}-${tabSequence}`,
            fileName: normalized,
            autoTitle: isAutoTitleName(normalized),
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
        // The strip is rebuilt from scratch below; keep the reader's place.
        const preservedScrollLeft = container.scrollLeft;
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
            tabButton.title = `${tab.fileName} (double-click to rename, hold and drag to reorder)`;
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

        container.scrollLeft = preservedScrollLeft;
        const activeButton = container.querySelector(".tab.is-active .tab-button");
        if (activeButton) activeButton.scrollIntoView({ block: "nearest", inline: "nearest" });
        updateTabFade();
    }

    function activateTab(tabId) {
        if (tabId === state.activeTabId) return;
        const nextTab = state.tabs.find((tab) => tab.id === tabId);
        if (!nextTab) return;

        // The strip rebuild below destroys the clicked button, dropping focus
        // to <body>: park it in the editor instead so typing keeps working.
        const focusWasInTabs = elements.tabs.contains(document.activeElement);
        captureTabState(getActiveTab());
        state.activeTabId = tabId;
        loadTabIntoEditor(nextTab);

        App.renderPreview();
        restorePreviewScroll();
        App.updateTextLevelIndicator();
        renderTabs();
        if (focusWasInTabs) elements.editor.focus();
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
        if (tabElement) {
            tabElement.classList.add("is-entering");
            // overflow:hidden exists only while the label is in motion;
            // leaving it on would clip the tab's focus ring afterwards.
            tabElement.addEventListener("animationend", () => {
                tabElement.classList.remove("is-entering");
            }, { once: true });
        }

        App.scheduleAutosave();
        elements.editor.focus();
    }

    async function closeTab(tabId) {
        const tab = state.tabs.find((entry) => entry.id === tabId);
        if (!tab) return;

        const isActive = tab.id === state.activeTabId;
        const content = isActive ? elements.editor.value : tab.content;

        // Read before the await: the confirm dialog moves focus to itself, so
        // a later read would always miss the tab strip.
        const focusWasInTabs = elements.tabs.contains(document.activeElement);

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
        if (activeTab) {
            activeTab.fileName = fileName;
            // Renaming to a generated name re-enables the heading follow;
            // any other name is a deliberate choice and locks it.
            activeTab.autoTitle = isAutoTitleName(fileName);
        }

        renderTabs();
        App.scheduleAutosave();
    }

    // Names the active tab from its first H1 while the tab still carries a
    // generated name. Called after every preview render; it exits before
    // writing anything when the name already matches, so it cannot loop.
    function updateAutoTitle() {
        const tab = getActiveTab();
        if (!tab || !tab.autoTitle) return;

        const heading = App.firstHeading(elements.editor.value);
        const desired = heading
            ? App.ensureMarkdownExtension(heading)
            : (isAutoTitleName(state.fileName) ? state.fileName : nextUntitledName());

        if (desired === state.fileName) return;
        state.fileName = desired;
        elements.fileNameInput.value = desired;
        tab.fileName = desired;
        renderTabs();
        App.scheduleAutosave();
    }

    // Plain vertical wheel over a strip scrolls it sideways; shift+wheel
    // and trackpad horizontal deltas stay on the browser's native path.
    // Bound on the tab strip and the toolbar — whichever row the wheel is on.
    function handleTabsWheel(event) {
        if (event.deltaY === 0 && event.deltaX === 0) return;
        if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
        const scroller = event.currentTarget;
        if (scroller.scrollWidth <= scroller.clientWidth) return;
        event.preventDefault();
        let scale = 1;
        if (event.deltaMode === 1) scale = 24;
        else if (event.deltaMode === 2) scale = scroller.clientWidth;
        scroller.scrollLeft += event.deltaY * scale;
    }

    // Edge fades show only while the strip overflows on that side.
    function updateTabFade() {
        const scroller = elements.tabs;
        const bar = scroller.closest(".tab-bar");
        if (!bar) return;
        const maxScroll = scroller.scrollWidth - scroller.clientWidth;
        bar.classList.toggle("has-fade-left", scroller.scrollLeft > 1);
        bar.classList.toggle("has-fade-right", scroller.scrollLeft < maxScroll - 1);
    }

    // --- Tab reordering -----------------------------------------------------
    // A long press lifts the tab out of the row: the tabs it passes slide
    // aside and the drop writes the new order back to state.tabs. The press
    // must hold still first, so touch keeps the strip's native sideways
    // scroll until the gesture clearly means "drag"; a mouse may also start
    // by moving a few pixels, which is how desktop tab strips behave.
    const LONG_PRESS_MS = 400;
    const MOUSE_DRAG_SLOP_PX = 6;
    const TOUCH_CANCEL_SLOP_PX = 10;
    const CLICK_SUPPRESS_TRAVEL_PX = 16;
    const DRAG_CLICK_SUPPRESS_MS = 300;
    const EDGE_SCROLL_ZONE_PX = 56;
    const EDGE_SCROLL_MAX_STEP_PX = 12;
    // Matches --duration-base: how long the eased-back tabs keep animating
    // after a cancelled drag before the drag styling comes off the strip.
    const DRAG_SETTLE_MS = 200;

    let pressState = null;
    let dragState = null;
    let edgeScrollFrame = 0;
    let lastDragEndAt = 0;

    function handleTabsPointerDown(event) {
        if (pressState || dragState) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (event.target.closest(".tab-close")) return;
        const tabElement = event.target.closest(".tab");
        if (!tabElement || !elements.tabs.contains(tabElement)) return;
        if (state.tabs.length < 2) return;

        pressState = {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            element: tabElement,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            travel: 0,
            timer: window.setTimeout(beginDrag, LONG_PRESS_MS),
        };
    }

    function cancelPress() {
        if (!pressState) return;
        window.clearTimeout(pressState.timer);
        pressState = null;
    }

    function handleTabsPointerMove(event) {
        if (dragState) {
            if (event.pointerId === dragState.pointerId) updateDrag(event.clientX, event.clientY);
            return;
        }
        if (!pressState || event.pointerId !== pressState.pointerId) return;

        pressState.lastX = event.clientX;
        pressState.lastY = event.clientY;
        const travel = Math.hypot(event.clientX - pressState.startX, event.clientY - pressState.startY);
        pressState.travel = Math.max(pressState.travel, travel);

        const isMouse = pressState.pointerType === "mouse";
        if (travel >= (isMouse ? MOUSE_DRAG_SLOP_PX : TOUCH_CANCEL_SLOP_PX)) {
            // A moving mouse means drag; a moving finger means the browser is
            // about to scroll the strip, so let it and drop the press.
            if (isMouse) beginDrag();
            else cancelPress();
        }
    }

    function handleTabsPointerUp(event) {
        const pointerId = event ? event.pointerId : undefined;
        if (dragState) {
            if (pointerId === undefined || pointerId === dragState.pointerId) endDrag(true);
            return;
        }
        if (pressState && (pointerId === undefined || pointerId === pressState.pointerId)) cancelPress();
    }

    function beginDrag() {
        const press = pressState;
        if (!press || dragState) return;
        window.clearTimeout(press.timer);

        const strip = elements.tabs;
        const stripRect = strip.getBoundingClientRect();
        const tabElements = Array.from(strip.querySelectorAll(".tab"));
        const originIndex = tabElements.indexOf(press.element);
        if (originIndex === -1) {
            pressState = null;
            return;
        }

        const gap = Number.parseFloat(window.getComputedStyle(strip).columnGap) || 0;
        // Positions are measured once, in strip-content coordinates: the
        // sibling transforms below never move layout, so they stay valid for
        // the whole drag and survive the strip scrolling under the pointer.
        const layout = tabElements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left - stripRect.left + strip.scrollLeft, width: rect.width };
        });

        dragState = {
            pointerId: press.pointerId,
            element: press.element,
            tabId: press.element.dataset.tabId,
            tabElements,
            layout,
            gap,
            width: layout[originIndex].width,
            originIndex,
            targetIndex: originIndex,
            grabOffset: (press.lastX - stripRect.left + strip.scrollLeft) - layout[originIndex].left,
            startX: press.startX,
            startY: press.startY,
            travel: press.travel,
            lastClientX: press.lastX,
            lastClientY: press.lastY,
        };
        pressState = null;

        strip.classList.add("is-drag-active");
        press.element.classList.add("is-dragging");
        try {
            press.element.setPointerCapture(press.pointerId);
        } catch (error) {
            // Capture only steadies the events; the window listeners suffice.
        }
        document.addEventListener("touchmove", preventDragTouchScroll, { passive: false });
        document.addEventListener("keydown", handleDragKeydown, true);
        updateDrag(press.lastX, press.lastY);
        startEdgeScroll();
    }

    function updateDrag(clientX, clientY) {
        const drag = dragState;
        if (!drag) return;
        drag.lastClientX = clientX;
        drag.lastClientY = clientY;
        drag.travel = Math.max(drag.travel, Math.hypot(clientX - drag.startX, clientY - drag.startY));

        const strip = elements.tabs;
        const stripRect = strip.getBoundingClientRect();
        const pointerContentX = clientX - stripRect.left + strip.scrollLeft;
        const desiredLeft = pointerContentX - drag.grabOffset;
        drag.element.style.transform = `translateX(${desiredLeft - drag.layout[drag.originIndex].left}px)`;

        const center = desiredLeft + drag.width / 2;
        const originCenter = drag.layout[drag.originIndex].left + drag.width / 2;
        let targetIndex = drag.originIndex;
        if (center < originCenter) {
            for (let index = drag.originIndex - 1; index >= 0; index -= 1) {
                const slot = drag.layout[index];
                if (center < slot.left + slot.width / 2) targetIndex = index;
                else break;
            }
        } else if (center > originCenter) {
            for (let index = drag.originIndex + 1; index < drag.tabElements.length; index += 1) {
                const slot = drag.layout[index];
                if (center > slot.left + slot.width / 2) targetIndex = index;
                else break;
            }
        }

        if (targetIndex !== drag.targetIndex) {
            drag.targetIndex = targetIndex;
            applyDragShifts();
        }
    }

    // Removing the dragged tab and re-inserting it at the target shifts every
    // tab in between by exactly one tab width plus the gap, whatever their
    // own widths are — so all of them move by the same amount.
    function applyDragShifts() {
        const drag = dragState;
        if (!drag) return;
        const shift = drag.width + drag.gap;
        drag.tabElements.forEach((element, index) => {
            if (index === drag.originIndex) return;
            let offset = 0;
            if (drag.targetIndex > drag.originIndex && index > drag.originIndex && index <= drag.targetIndex) {
                offset = -shift;
            } else if (drag.targetIndex < drag.originIndex && index >= drag.targetIndex && index < drag.originIndex) {
                offset = shift;
            }
            element.style.transform = offset === 0 ? "" : `translateX(${offset}px)`;
        });
    }

    // Dragging past the strip's edge scrolls it, so every tab stays reachable
    // even when the pointer cannot travel any further.
    function startEdgeScroll() {
        stopEdgeScroll();
        const tick = () => {
            const drag = dragState;
            if (!drag) return;
            const strip = elements.tabs;
            const stripRect = strip.getBoundingClientRect();
            let step = 0;
            if (drag.lastClientX < stripRect.left + EDGE_SCROLL_ZONE_PX) {
                step = -Math.ceil((stripRect.left + EDGE_SCROLL_ZONE_PX - drag.lastClientX) / 8);
            } else if (drag.lastClientX > stripRect.right - EDGE_SCROLL_ZONE_PX) {
                step = Math.ceil((drag.lastClientX - (stripRect.right - EDGE_SCROLL_ZONE_PX)) / 8);
            }
            if (step !== 0 && strip.scrollWidth > strip.clientWidth) {
                const next = Math.sign(step) * Math.min(Math.abs(step), EDGE_SCROLL_MAX_STEP_PX);
                const before = strip.scrollLeft;
                strip.scrollLeft = before + next;
                if (strip.scrollLeft !== before) updateDrag(drag.lastClientX, drag.lastClientY);
            }
            edgeScrollFrame = window.requestAnimationFrame(tick);
        };
        edgeScrollFrame = window.requestAnimationFrame(tick);
    }

    function stopEdgeScroll() {
        if (edgeScrollFrame) window.cancelAnimationFrame(edgeScrollFrame);
        edgeScrollFrame = 0;
    }

    // Touch scrolling cannot be stopped from a pointer event: the strip's
    // native pan wins unless the touchmove default is cancelled while the
    // drag owns the gesture.
    function preventDragTouchScroll(event) {
        if (dragState) event.preventDefault();
    }

    function handleDragKeydown(event) {
        if (!dragState || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        endDrag(false);
    }

    function endDrag(shouldCommit) {
        const drag = dragState;
        if (!drag) return;
        dragState = null;

        stopEdgeScroll();
        document.removeEventListener("touchmove", preventDragTouchScroll);
        document.removeEventListener("keydown", handleDragKeydown, true);
        try {
            drag.element.releasePointerCapture(drag.pointerId);
        } catch (error) {
            // The pointer is already gone (pointercancel, window blur).
        }

        const didReorder = drag.targetIndex !== drag.originIndex;
        // A press that never went anywhere is still a click; only a real
        // reorder (or a real drag) swallows the click that follows the drop.
        if (didReorder || drag.travel >= CLICK_SUPPRESS_TRAVEL_PX) lastDragEndAt = Date.now();

        drag.tabElements.forEach((element) => { element.style.transform = ""; });
        drag.element.classList.remove("is-dragging");

        const focusWasInTabs = elements.tabs.contains(document.activeElement);
        const strip = elements.tabs;

        if (shouldCommit && didReorder) {
            const [movedTab] = state.tabs.splice(drag.originIndex, 1);
            state.tabs.splice(drag.targetIndex, 0, movedTab);
            strip.classList.remove("is-drag-active");
            renderTabs();
            App.scheduleAutosave();
        } else {
            // Nothing to rebuild: let the cleared transforms ease the tabs
            // home, then drop the drag styling (instant under reduced motion).
            window.setTimeout(() => {
                if (!dragState) strip.classList.remove("is-drag-active");
            }, App.reducedMotionQuery.matches ? 0 : DRAG_SETTLE_MS);
        }

        if (focusWasInTabs) {
            const button = elements.tabs.querySelector(`.tab-button[data-tab-id="${drag.tabId}"]`);
            if (button) button.focus();
        }
    }

    function wasRecentDrag() {
        return Date.now() - lastDragEndAt < DRAG_CLICK_SUPPRESS_MS;
    }

    // Keyboard equivalent of the drag, for the strip's focus order.
    function moveTabBy(tabId, delta) {
        const index = state.tabs.findIndex((tab) => tab.id === tabId);
        const targetIndex = index + delta;
        if (index === -1 || targetIndex < 0 || targetIndex >= state.tabs.length) return;

        const [movedTab] = state.tabs.splice(index, 1);
        state.tabs.splice(targetIndex, 0, movedTab);
        renderTabs();
        App.scheduleAutosave();

        const button = elements.tabs.querySelector(`.tab-button[data-tab-id="${tabId}"]`);
        if (button) button.focus();
        App.showNotice(`Moved ${movedTab.fileName} to position ${targetIndex + 1} of ${state.tabs.length}`);
    }

    function handleTabsClick(event) {
        if (wasRecentDrag()) return;
        const closeButton = event.target.closest(".tab-close");
        if (closeButton) {
            closeTab(closeButton.dataset.tabId);
            return;
        }
        // Pointer capture retargets the click after a drag to the tab wrapper;
        // if that drag never went anywhere (wasRecentDrag already returned for
        // one that did), fall through to the button inside it.
        const tabButton = event.target.closest(".tab-button")
            || event.target.closest(".tab")?.querySelector(".tab-button");
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
        if (wasRecentDrag()) return;
        const onTab = event.target.closest(".tab-button") || event.target.closest(".tab");
        if (!onTab) return;
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
        } else if (event.altKey && (key === "arrowleft" || key === "arrowright")) {
            event.preventDefault();
            moveTabBy(state.activeTabId, key === "arrowleft" ? -1 : 1);
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
        if (typeof rawTab.autoTitle === "boolean") tab.autoTitle = rawTab.autoTitle;
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
        // A fresh document starts at the top with a fresh caret; the browser
        // would otherwise keep whatever offset the old text left behind.
        elements.editor.setSelectionRange(0, 0);
        state.fileName = fileName;
        elements.fileNameInput.value = fileName;

        const activeTab = getActiveTab();
        if (activeTab) {
            activeTab.content = content;
            activeTab.fileName = fileName;
            activeTab.autoTitle = isAutoTitleName(App.ensureMarkdownExtension(fileName));
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

    async function openFile(file) {
        if (!file) return;
        if (file.size > MAX_OPEN_FILE_BYTES) {
            App.showNotice("That file is larger than 5 MB.", true);
            return;
        }

        let fileText;
        try {
            fileText = await file.text();
        } catch (error) {
            App.showNotice("Could not read that file.", true);
            return;
        }

        // NUL bytes mean binary data behind a text-looking file name.
        if (fileText.includes("\u0000")) {
            App.showNotice(`"${file.name}" is not a text file.`, true);
            return;
        }

        if (!(await confirmReplaceDocument())) return;

        // HTML files open as Markdown: exact source when the file carries our
        // round-trip marker, converted DOM→Markdown otherwise (see import.js).
        if (/\.x?html?$/i.test(file.name)) {
            const converted = App.htmlExportToMarkdown(fileText);
            if (converted.error) {
                App.showNotice(`"${file.name}" is not a Mark⁺ HTML export.`, true);
                return;
            }
            setDocument(converted.markdown, file.name.replace(/\.x?html?$/i, ".md"));
            App.showNotice(`Opened ${file.name} as Markdown`);
            return;
        }

        setDocument(fileText, file.name);
        App.showNotice(`Opened ${file.name}`);
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
        openFile,
        downloadMarkdown,
        loadTabs,
        renderTabs,
        restorePreviewScroll,
        renameActiveTab,
        updateAutoTitle,
        handleTabsWheel,
        updateTabFade,
        createNewTab,
        handleTabsClick,
        handleTabsAuxClick,
        handleTabsDoubleClick,
        handleTabsPointerDown,
        handleTabsPointerMove,
        handleTabsPointerUp,
        moveTabBy,
        handleTabShortcuts,
    });
})();
