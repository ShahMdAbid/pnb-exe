import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import katex from 'katex';
import localforage from 'localforage';

import SustLogo from '../assets/sust_logo.png';
import BegulaImg from '../assets/Begula.png';
const ASSET_MAP = { SUST_LOGO: SustLogo, BEGULA_IMG: BegulaImg };

const hideDeco = Decoration.mark({ class: "cm-hidden-markup" });

class ImageWidget extends WidgetType {
    constructor(altText, source) { super(); this.altText = altText; this.source = source; }
    // 🛡️ Ensure CodeMirror caches this DOM node
    eq(other) { return this.source === other.source && this.altText === other.altText; }
    ignoreEvent() { return false; }
    toDOM() {
        const parts = this.altText ? this.altText.split('|') : ["Image"];
        const width = parts[1] || '300';
        const wrapper = document.createElement("span");
        wrapper.style.display = "inline-block";
        wrapper.style.width = "100%";
        wrapper.style.textAlign = "center";
        wrapper.style.padding = "10px 0";
        const img = document.createElement("img");
        img.style.maxWidth = "100%";
        img.style.width = `${width}px`;
        img.style.borderRadius = "4px";
        if (this.source.startsWith('poring-asset://')) {
            img.src = this.source;
        } else if (this.source.startsWith('poring_img_')) {
            localforage.getItem(this.source).then(blob => {
                if (blob) img.src = URL.createObjectURL(blob);
            });
        } else {
            img.src = ASSET_MAP[this.source] || this.source;
        }
        wrapper.appendChild(img);
        return wrapper;
    }
}

class VSpaceWidget extends WidgetType {
    // 🛡️ CRITICAL: Prevent infinite layout loops
    eq(other) { return true; }
    toDOM() {
        const span = document.createElement("span");
        span.style.display = "block";
        span.style.width = "100%";
        span.style.height = `24px`;
        span.style.backgroundColor = "rgba(139, 92, 246, 0.03)";
        span.style.borderLeft = "2px dashed rgba(139, 92, 246, 0.2)";
        return span;
    }
}

class PageBreakWidget extends WidgetType {
    // 🛡️ CRITICAL: Prevent infinite layout loops
    eq(other) { return true; }
    toDOM() {
        const wrap = document.createElement("div");
        wrap.style.width = "100%";
        wrap.style.borderBottom = "2px dashed #cbd5e1";
        wrap.style.margin = "20px 0";
        wrap.style.position = "relative";

        const label = document.createElement("span");
        label.innerText = "Page Break";
        label.style.position = "absolute";
        label.style.right = "0";
        label.style.top = "-10px";
        label.style.background = "#f1f5f9";
        label.style.color = "#64748b";
        label.style.padding = "2px 8px";
        label.style.fontSize = "10px";
        label.style.borderRadius = "4px";

        wrap.appendChild(label);
        return wrap;
    }
}

class MathWidget extends WidgetType {
    constructor(math, isBlock) {
        super();
        this.math = math || "";
        this.isBlock = isBlock;
    }
    // 🛡️ Ensure CodeMirror correctly caches Math blocks
    eq(other) { return this.math === other.math && this.isBlock === other.isBlock; }
    ignoreEvent() { return false; }
    toDOM() {
        const container = document.createElement("span");
        if (this.isBlock) {
            container.className = "math-center-wrapper";
            container.style.display = "inline-block";
            container.style.width = "100%";
            container.style.textAlign = "center";
            container.style.cursor = "text";
            container.style.padding = "10px 0";
            container.title = "Click to edit formula";
        } else {
            container.style.cursor = "text";
            container.style.display = "inline-block";
        }

        try {
            // KaTeX can throw if syntax is completely invalid, we catch it gracefully
            katex.render(this.math, container, { displayMode: this.isBlock, throwOnError: false, strict: false });
        } catch (err) {
            container.innerText = this.isBlock ? `$$${this.math}$$` : `$${this.math}$`;
            container.style.color = "red";
        }
        return container;
    }
}

const livePreviewPlugin = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = this.buildDecorations(view); }
    update(update) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = this.buildDecorations(update.view);
        }
    }

    buildDecorations(view) {
        // 🛡️ The Ultimate Failsafe: Prevents the "White Screen of Death"
        try {
            const builder = new RangeSetBuilder();
            const selFrom = view.state.selection.main.from;
            const selTo = view.state.selection.main.to;
            const decos = [];

            // Chunk text for performance
            const vpFrom = Math.max(0, view.viewport.from - 2500);
            const vpTo = Math.min(view.state.doc.length, view.viewport.to + 2500);
            const chunkText = view.state.sliceDoc(vpFrom, vpTo);
            const mathRanges = [];

            // --- 1. PARSE IMAGES ---
            syntaxTree(view.state).iterate({
                from: vpFrom,
                to: vpTo,
                enter: (node) => {
                    if (node.name === "Image") {
                        const isSelected = selFrom <= node.to && selTo >= node.from;
                        if (!isSelected) {
                            const safeFrom = Math.max(0, Math.min(node.from, view.state.doc.length));
                            const safeTo = Math.max(0, Math.min(node.to, view.state.doc.length));
                            if (safeFrom >= safeTo) return;

                            const text = view.state.sliceDoc(safeFrom, safeTo);
                            const match = text.match(/!\[(.*?)\]\((.*?)\)/);
                            if (match) {
                                decos.push({
                                    from: safeFrom,
                                    to: safeTo,
                                    deco: Decoration.replace({ widget: new ImageWidget(match[1], match[2]) })
                                });
                            }
                        }
                    }
                }
            });

            // --- 2. PARSE MATH BLOCKS ---
            const blockMathRegex = /\$\$([\s\S]*?)\$\$/g;
            let match;
            while ((match = blockMathRegex.exec(chunkText)) !== null) {
                const start = vpFrom + match.index;
                const end = start + match[0].length;
                mathRanges.push({ from: start, to: end });
                if (!(selFrom <= end && selTo >= start)) {
                    decos.push({ from: start, to: end, deco: Decoration.replace({ widget: new MathWidget(match[1], true) }) });
                }
            }

            const inlineMathRegex = /(?:^|[^$])\$([^$\n]+?)\$(?!\$)/g;
            while ((match = inlineMathRegex.exec(chunkText)) !== null) {
                const offset = match[0].startsWith('$') ? 0 : 1;
                const start = vpFrom + match.index + offset;
                const end = start + match[0].length - offset;

                if (!mathRanges.some(r => start >= r.from && end <= r.to)) {
                    mathRanges.push({ from: start, to: end });
                    if (!(selFrom <= end && selTo >= start)) {
                        decos.push({ from: start, to: end, deco: Decoration.replace({ widget: new MathWidget(match[1], false) }) });
                    }
                }
            }

            const isInsideMath = (offset) => mathRanges.some(r => offset >= r.from && offset < r.to);

            // 🛡️ Safely clamp bounds so CodeMirror lineAt() never throws an error
            const isCursorNear = (start, end) => {
                try {
                    const safeStart = Math.max(0, Math.min(start, view.state.doc.length));
                    const safeEnd = Math.max(0, Math.min(end, view.state.doc.length));
                    const lineStart = view.state.doc.lineAt(safeStart).from;
                    const lineEnd = view.state.doc.lineAt(safeEnd).to;
                    return selFrom <= lineEnd && selTo >= lineStart;
                } catch (e) {
                    return false;
                }
            };

            // --- 3. PARSE HTML STYLES ---
            const htmlFormats = [
                { regex: /<u>([\s\S]*?)<\/u>/g, openLen: 3, closeLen: 4, className: "underline" },
                { regex: /<mark>([\s\S]*?)<\/mark>/g, openLen: 6, closeLen: 7, className: "cm-highlight" }
            ];

            htmlFormats.forEach(({ regex, openLen, closeLen, className }) => {
                while ((match = regex.exec(chunkText)) !== null) {
                    const start = vpFrom + match.index;
                    const end = start + match[0].length;
                    if (isInsideMath(start)) continue;

                    const innerStart = start + openLen;
                    const innerEnd = end - closeLen;

                    if (!isCursorNear(start, end)) {
                        decos.push({ from: start, to: innerStart, deco: hideDeco });
                        decos.push({ from: innerEnd, to: end, deco: hideDeco });
                    }
                    if (innerStart < innerEnd) {
                        decos.push({ from: innerStart, to: innerEnd, deco: Decoration.mark({ class: className }) });
                    }
                }
            });

            const spanRegex = /<span style="color:\s*([a-zA-Z#0-9]+);?">([\s\S]*?)<\/span>/g;
            while ((match = spanRegex.exec(chunkText)) !== null) {
                const start = vpFrom + match.index;
                const end = start + match[0].length;
                if (isInsideMath(start)) continue;

                const color = match[1];
                const openTagLen = match[0].indexOf('>') + 1;
                const innerStart = start + openTagLen;
                const innerEnd = end - 7;

                if (!isCursorNear(start, end)) {
                    decos.push({ from: start, to: innerStart, deco: hideDeco });
                    decos.push({ from: innerEnd, to: end, deco: hideDeco });
                }
                if (innerStart < innerEnd) {
                    decos.push({ from: innerStart, to: innerEnd, deco: Decoration.mark({ attributes: { style: `color: ${color};` } }) });
                }
            }

            const divRegex = /<div align="(center|right|left)">([\s\S]*?)<\/div>/g;
            while ((match = divRegex.exec(chunkText)) !== null) {
                const start = vpFrom + match.index;
                const end = start + match[0].length;
                if (isInsideMath(start)) continue;

                const align = match[1];
                const openTagLen = match[0].indexOf('>') + 1;
                const innerStart = start + openTagLen;
                const innerEnd = end - 6;

                if (!isCursorNear(start, end)) {
                    decos.push({ from: start, to: innerStart, deco: hideDeco });
                    decos.push({ from: innerEnd, to: end, deco: hideDeco });
                }

                let pos = innerStart;
                while (pos <= innerEnd) {
                    if (pos > view.state.doc.length) break;
                    const line = view.state.doc.lineAt(pos);
                    if (!isInsideMath(line.from)) {
                        decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: `cm-line-${align}` }) });
                    }
                    pos = line.to + 1;
                }
            }

            const brRegex = /<br\s*\/?>/g;
            while ((match = brRegex.exec(chunkText)) !== null) {
                const start = vpFrom + match.index;
                const end = start + match[0].length;
                if (!isInsideMath(start) && !isCursorNear(start, end)) {
                    decos.push({ from: start, to: end, deco: Decoration.replace({ widget: new VSpaceWidget() }) });
                }
            }

            const pbRegex = /<div style="page-break-before:\s*always;?"><\/div>/g;
            while ((match = pbRegex.exec(chunkText)) !== null) {
                const start = vpFrom + match.index;
                const end = start + match[0].length;
                if (!isInsideMath(start) && !isCursorNear(start, end)) {
                    decos.push({ from: start, to: end, deco: Decoration.replace({ widget: new PageBreakWidget() }) });
                }
            }

            // --- 4. PARSE STANDARD MARKDOWN ---
            for (let { from, to } of view.visibleRanges) {
                let pos = from;
                while (pos <= to) {
                    if (pos > view.state.doc.length) break;
                    const line = view.state.doc.lineAt(pos);
                    const text = line.text;
                    const isCursorOnLine = selFrom <= line.to && selTo >= line.from;

                    if (!isCursorOnLine && !isInsideMath(line.from)) {
                        const headMatch = text.match(/^(#+)\s*/);
                        if (headMatch) {
                            const level = headMatch[1].length;
                            decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: `cm-heading${level}` }) });
                            decos.push({ from: line.from, to: line.from + headMatch[0].length, deco: hideDeco });
                        }

                        const mdFormats = [
                            { regex: /\*\*([^*]+)\*\*/g, markLen: 2, className: "cm-strong" },
                            { regex: /(?:^|[^\*])\*([^*]+)\*(?!\*)/g, markLen: 1, className: "cm-em" },
                            { regex: /\~\~([^~]+)\~\~/g, markLen: 2, className: "cm-strikethrough" },
                            { regex: /`([^`]+)`/g, markLen: 1, className: "cm-inline-code" }
                        ];

                        mdFormats.forEach(({ regex, markLen, className }) => {
                            let matchFormat;
                            while ((matchFormat = regex.exec(text)) !== null) {
                                const offset = matchFormat[0].startsWith('*') ? 0 : 1;
                                const startIdx = matchFormat.index + offset;
                                const endIdx = startIdx + matchFormat[0].length - offset;

                                const absStart = line.from + startIdx;
                                const absEnd = line.from + endIdx;

                                if (isInsideMath(absStart)) continue;

                                const innerStart = absStart + markLen;
                                const innerEnd = absEnd - markLen;

                                // 🛡️ Prevent empty marks from crashing builder
                                if (innerStart <= innerEnd) {
                                    decos.push({ from: absStart, to: innerStart, deco: hideDeco });
                                    decos.push({ from: innerEnd, to: absEnd, deco: hideDeco });
                                    if (innerStart < innerEnd) {
                                        decos.push({ from: innerStart, to: innerEnd, deco: Decoration.mark({ class: className }) });
                                    }
                                }
                            }
                        });
                    }
                    pos = line.to + 1;
                }
            }

            const explanationRegex = /\[\[(.+?)\]\]\(([\s\S]+?)\)/g;
            while ((match = explanationRegex.exec(chunkText)) !== null) {
                const start = vpFrom + match.index;
                const end = start + match[0].length;

                const word = match[1];
                const innerStart = start + 2;
                const innerEnd = innerStart + word.length;

                if (!isCursorNear(start, end)) {
                    decos.push({ from: start, to: innerStart, deco: hideDeco });
                    decos.push({ from: innerEnd, to: end, deco: hideDeco });
                }
                if (innerStart < innerEnd) {
                    decos.push({ from: innerStart, to: innerEnd, deco: Decoration.mark({ class: "cm-poring-blue", attributes: { style: "text-decoration: underline; cursor: pointer;" } }) });
                }
            }

            // 🛡️ Safely sort and build decorations
            decos.sort((a, b) => a.from - b.from || a.to - b.to);
            let lastEnd = -1;
            for (const d of decos) {
                if (d.from >= lastEnd) {
                    try { builder.add(d.from, d.to, d.deco); lastEnd = d.to; } catch (e) { }
                }
            }
            return builder.finish();

        } catch (error) {
            console.error("Critical parsing error averted:", error);
            return Decoration.none; // Will prevent React from crashing
        }
    }
}, { decorations: v => v.decorations });

const liveTheme = EditorView.theme({
    "&": { backgroundColor: "transparent", height: "100%", color: "var(--text-main)" },
    ".cm-scroller": { fontFamily: "var(--p-font)", fontSize: "var(--p-size)", lineHeight: "1.6", padding: "40px 0" },
    ".cm-content": { paddingLeft: "20px", paddingRight: "20px", maxWidth: "850px", margin: "0 auto" },
    ".cm-hidden-markup": { display: "none" },
    ".cm-heading1": { fontSize: "2.2rem", fontWeight: "800", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.2em", paddingTop: "0.5em" },
    ".cm-heading2": { fontSize: "1.8rem", fontWeight: "700", paddingTop: "0.5em" },
    ".cm-heading3": { fontSize: "1.4rem", fontWeight: "600", paddingTop: "0.5em" },
    ".cm-line-center": { textAlign: "center" },
    ".cm-line-right": { textAlign: "right" },
    ".cm-line-left": { textAlign: "left" },
    ".cm-poring-blue": { color: "#3b82f6" },
    ".cm-strong": { fontWeight: "bold" },
    ".cm-em": { fontStyle: "italic" },
    ".cm-strikethrough": { textDecoration: "line-through" },
    ".underline": { textDecoration: "underline" },
    ".cm-highlight": { backgroundColor: "rgba(255, 212, 0, 0.4)", borderRadius: "3px", padding: "0 2px" },
    ".cm-inline-code": { backgroundColor: "rgba(128, 128, 128, 0.15)", color: "#c2185b", padding: "2px 4px", borderRadius: "4px", fontFamily: '"JetBrains Mono", monospace', fontSize: "0.9em" }
});

const liveMdExtension = markdown({ base: markdownLanguage, codeLanguages: languages });
const liveBasicSetup = { lineNumbers: false, foldGutter: false };

const LivePreviewEditor = ({ value, onChange, onPaste, placeholder, editorViewRef }) => {
    const onPasteRef = React.useRef(onPaste);
    React.useEffect(() => { onPasteRef.current = onPaste; }, [onPaste]);

    const extensions = useMemo(() => [
        liveMdExtension,
        EditorView.lineWrapping,
        livePreviewPlugin,
        EditorView.domEventHandlers({
            paste: (event, view) => {
                if (onPasteRef.current) {
                    onPasteRef.current(event);
                }
            }
        })
    ], []);

    return (
        <div className="colorful-editor-container" style={{ flex: 1, height: '100%', display: 'flex' }}>
            <CodeMirror
                value={value}
                height="100%"
                style={{ flex: 1, overflow: 'auto' }}
                onChange={onChange}
                theme={liveTheme}
                extensions={extensions}
                placeholder={placeholder}
                basicSetup={liveBasicSetup}
                onCreateEditor={(view) => { if (editorViewRef) editorViewRef.current = view; }}
            />
        </div>
    );
};

export default LivePreviewEditor;