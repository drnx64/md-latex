"use strict";

// Shared namespace. Load order matters: core.js first, app.js last.
window.App = {
    STORAGE_KEYS: Object.freeze({
        document: "markdownLatexEditor.document.v1",
        theme: "markdownLatexEditor.theme.v1",
        splitPercent: "markdownLatexEditor.splitPercent.v1",
        viewMode: "markdownLatexEditor.viewMode.v1",
        syncScroll: "markdownLatexEditor.syncScroll.v1",
    }),

    RENDER_DELAY_MS: 120,
    AUTOSAVE_DELAY_MS: 500,
    NOTICE_DURATION_MS: 4000,
    MIN_SPLIT_PERCENT: 20,
    MAX_SPLIT_PERCENT: 80,
    DIVIDER_KEY_STEP_PERCENT: 2,
    MAX_OPEN_FILE_BYTES: 5 * 1024 * 1024,
    READING_WORDS_PER_MINUTE: 200,
    VIEW_MODES: ["edit", "split", "preview"],

    // Private-use characters mark where math was lifted out of the Markdown.
    MATH_TOKEN_START: "\uE000",
    MATH_TOKEN_END: "\uE001",
    MATH_TOKEN_PATTERN: /\uE000(\d+)\uE001/g,
    DISPLAY_MATH_PARAGRAPH_PATTERN: /<p>\s*\uE000(\d+)\uE001\s*<\/p>/g,

    CODE_SPAN_PATTERN: /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/,
    DISPLAY_DOLLAR_PATTERN: /\$\$([\s\S]+?)\$\$/g,
    LATEX_ENVIRONMENT_PATTERN: /\\begin\{(equation\*?|align\*?|gather\*?)\}[\s\S]*?\\end\{\1\}/g,
    DISPLAY_BRACKET_PATTERN: /\\\[([\s\S]+?)\\\]/g,
    INLINE_PAREN_PATTERN: /\\\(([\s\S]+?)\\\)/g,
    INLINE_DOLLAR_PATTERN: /(?<![\\$])\$(?![\s$])((?:[^\n$\\]|\\.)+?)(?<!\s)\$(?!\d)/g,
    LINE_MARKER_PATTERN: /^(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>\s?)/,
    LIST_LINE_PATTERN: /^(\s*)([-*+]|\d+\.)\s(\[[ xX]\]\s)?(.*)$/,

    narrowScreenQuery: window.matchMedia("(max-width: 800px)"),

    state: {
        fileName: "untitled.md",
        viewMode: "split",
        isScrollSyncEnabled: true,
        renderTimer: null,
        autosaveTimer: null,
        noticeTimer: null,
        scrollSource: null,
    },

    elements: {
        workspace: document.getElementById("workspace"),
        editor: document.getElementById("editor"),
        divider: document.getElementById("divider"),
        previewPane: document.getElementById("previewPane"),
        preview: document.getElementById("preview"),
        fileNameInput: document.getElementById("fileNameInput"),
        fileInput: document.getElementById("fileInput"),
        sampleDocument: document.getElementById("sampleDocument"),
        syncScrollButton: document.getElementById("syncScrollButton"),
        themeButton: document.getElementById("themeButton"),
        newButton: document.getElementById("newButton"),
        openButton: document.getElementById("openButton"),
        downloadButton: document.getElementById("downloadButton"),
        exportHtmlButton: document.getElementById("exportHtmlButton"),
        printButton: document.getElementById("printButton"),
        exportPdfButton: document.getElementById("exportPdfButton"),
        overflowButton: document.getElementById("overflowButton"),
        overflowMenu: document.getElementById("overflowMenu"),
        wordCount: document.getElementById("wordCount"),
        characterCount: document.getElementById("characterCount"),
        readingTime: document.getElementById("readingTime"),
        saveStatus: document.getElementById("saveStatus"),
        notice: document.getElementById("notice"),
        viewModeButtons: document.querySelectorAll("[data-view-mode]"),
        formatButtons: document.querySelectorAll("[data-format]"),
    },
};
