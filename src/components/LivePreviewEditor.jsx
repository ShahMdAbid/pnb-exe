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

const hideDeco = Decoration.replace({});

// --- IMAGE WIDGET ---
class ImageWidget extends WidgetType {
    constructor(altText, source) { super(); this.altText = altText; this.source = source; }
    eq(other) { return this.source === other.source; }
    ignoreEvent() { return false; }
    toDOM() {
        const parts = this.altText ? this.altText.split('|') : ["Image"];
        const width = parts[1] || '300';
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.justifyContent = "center";
        wrapper.style.padding = "10px 0";

        const img = document.createElement("img");
        img.style.maxWidth = "100%";
        img.style.width = `${width}px`;
        img.style.borderRadius = "4px";

        if (this.source.startsWith('poring_img_')) {
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
    constructor(lines) { super(); this.lines = lines; }
    toDOM() {
        const div = document.createElement("div");
        div.style.height = `${this.lines * 24}px`;
        div.style.backgroundColor = "rgba(139, 92, 246, 0.03)";
        div.style.borderLeft = "2px dashed rgba(139, 92, 246, 0.2)";
        return div;
    }
}

class MathWidget extends WidgetType {
    constructor(math, isBlock) {
        super();
        this.math = math;
        this.isBlock = isBlock;
    }

    eq(other) {
        return this.math === other.math && this.isBlock === other.isBlock;
    }

    ignoreEvent() {
        return false;
    }

    toDOM() {
        const container = document.createElement(this.isBlock ? "div" : "span");

        if (this.isBlock) {
            container.className = "math-center-wrapper";
            container.style.cursor = "text";
            container.style.padding = "10px 0";
            container.title = "Click to edit formula";
        } else {
            container.style.cursor = "text";
            container.style.display = "inline-block";
        }

        try {
            katex.render(this.math, container, {
                displayMode: this.isBlock,
                throwOnError: false,
                strict: false
            });
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
        const builder = new RangeSetBuilder();
        const selFrom = view.state.selection.main.from;
        const selTo = view.state.selection.main.to;

        const decos = [];
        const docText = view.state.doc.toString();
        const mathRanges = [];

        // --- 1. RENDER IMAGES ---
        syntaxTree(view.state).iterate({
            enter: (node) => {
                if (node.name === "Image") {
                    const isSelected = selFrom <= node.to && selTo >= node.from;
                    if (!isSelected) {
                        const text = view.state.sliceDoc(node.from, node.to);
                        const match = text.match(/!\[(.*?)\]\((.*?)\)/);
                        if (match) {
                            decos.push({
                                from: node.from,
                                to: node.to,
                                deco: Decoration.replace({ widget: new ImageWidget(match[1], match[2]) })
                            });
                        }
                    }
                }
            }
        });

        // 2. SCAN FOR BLOCK MATH ($$ ... $$)
        const blockMathRegex = /\$\$([\s\S]*?)\$\$/g;
        let match;
        while ((match = blockMathRegex.exec(docText)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            mathRanges.push({ from: start, to: end });

            const isSelected = selFrom <= end && selTo >= start;
            if (!isSelected) {
                decos.push({
                    from: start,
                    to: end,
                    deco: Decoration.replace({ widget: new MathWidget(match[1], true) })
                });
            }
        }

        // 3. SCAN FOR INLINE MATH ($ ... $)
        const inlineMathRegex = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g;
        while ((match = inlineMathRegex.exec(docText)) !== null) {
            const start = match.index;
            const end = start + match[0].length;

            const inBlock = mathRanges.some(r => start >= r.from && end <= r.to);
            if (!inBlock) {
                mathRanges.push({ from: start, to: end });

                const isSelected = selFrom <= end && selTo >= start;
                if (!isSelected) {
                    decos.push({
                        from: start,
                        to: end,
                        deco: Decoration.replace({ widget: new MathWidget(match[1], false) })
                    });
                }
            }
        }

        const isInsideMath = (offset) => mathRanges.some(r => offset >= r.from && offset < r.to);

        // 4. SCAN LINE BY LINE
        for (let { from, to } of view.visibleRanges) {
            let pos = from;
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                const text = line.text;
                const isCursorOnLine = selFrom <= line.to && selTo >= line.from;

                if (isInsideMath(line.from) && isInsideMath(line.to)) {
                    pos = line.to + 1;
                    if (pos > view.state.doc.length) break;
                    continue;
                }

                const vMatch = text.match(/^\s*\/\/(\d+)\s*$/);
                if (vMatch && !isCursorOnLine && !isInsideMath(line.from)) {
                    decos.push({ from: line.from, to: line.to, deco: Decoration.replace({ widget: new VSpaceWidget(parseInt(vMatch[1], 10)) }) });
                }

                if (!isCursorOnLine) {
                    const alignMatch = text.match(/\b(center|right|left)\[/);
                    if (alignMatch && !isInsideMath(line.from + alignMatch.index)) {
                        decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: `cm-line-${alignMatch[1]}` }) });
                    }

                    const headMatch = text.match(/^(#+)\s*/);
                    if (headMatch && !isInsideMath(line.from)) {
                        const level = headMatch[1].length;
                        decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: `cm-heading${level}` }) });
                        decos.push({ from: line.from, to: line.from + headMatch[0].length, deco: hideDeco });
                    }

                    const tags = ['red', 'blue', 'green', 'orange', 'purple', 'gray', 'center', 'right', 'left'];
                    const processTags = (str, offset) => {
                        const tagRegex = new RegExp(`\\b(${tags.join('|')})\\[`, 'g');
                        let matchTag;
                        while ((matchTag = tagRegex.exec(str)) !== null) {
                            const tagName = matchTag[1];
                            const startIdx = matchTag.index;
                            const absStart = offset + startIdx;

                            if (isInsideMath(absStart)) continue;

                            const openBracketIdx = startIdx + tagName.length;
                            let depth = 1, j = openBracketIdx + 1;
                            while (j < str.length && depth > 0) {
                                if (str[j] === '[') depth++;
                                else if (str[j] === ']') depth--;
                                j++;
                            }
                            if (depth === 0) {
                                const endBracketIdx = j - 1;
                                decos.push({ from: offset + startIdx, to: offset + openBracketIdx + 1, deco: hideDeco });
                                decos.push({ from: offset + endBracketIdx, to: offset + endBracketIdx + 1, deco: hideDeco });
                                decos.push({ from: offset + openBracketIdx + 1, to: offset + endBracketIdx, deco: Decoration.mark({ class: `cm-poring-${tagName}` }) });
                                const innerContent = str.substring(openBracketIdx + 1, endBracketIdx);
                                processTags(innerContent, offset + openBracketIdx + 1);
                            }
                        }
                    };
                    processTags(text, line.from);

                    // 1. Process Standard and Custom Formatting
                    const formats = [
                        { regex: /\*\*(.*?)\*\*/g, markLen: 2, className: "cm-strong" },
                        { regex: /(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, markLen: 1, className: "cm-em" },
                        { regex: /\+\+(.*?)\+\+/g, markLen: 2, className: "underline" },
                        { regex: /\~\~(.*?)\~\~/g, markLen: 2, className: "cm-strikethrough" },
                        { regex: /(?<!\w)\=\=(.*?)\=\=/g, markLen: 2, className: "cm-highlight" },
                        { regex: /`([^`]+)`/g, markLen: 1, className: "cm-inline-code" }
                    ];

                    formats.forEach(({ regex, markLen, className }) => {
                        let matchFormat;
                        while ((matchFormat = regex.exec(text)) !== null) {
                            const startIdx = matchFormat.index;
                            const endIdx = startIdx + matchFormat[0].length;
                            const absStart = line.from + startIdx;
                            const absEnd = line.from + endIdx;

                            if (isInsideMath(absStart)) continue;

                            decos.push({ from: absStart, to: absStart + markLen, deco: hideDeco });
                            decos.push({ from: absEnd - markLen, to: absEnd, deco: hideDeco });
                            decos.push({ from: absStart + markLen, to: absEnd - markLen, deco: Decoration.mark({ class: className }) });
                        }
                    });

                    // 2. Process Colored Highlights (e.g., red==text==)
                    const colorHighlightRegex = /\b(red|blue|green|orange|purple|gray)\=\=(.*?)\=\=/g;
                    let chMatch;
                    while ((chMatch = colorHighlightRegex.exec(text)) !== null) {
                        const color = chMatch[1];
                        const startIdx = chMatch.index;
                        const endIdx = startIdx + chMatch[0].length;
                        const absStart = line.from + startIdx;
                        const absEnd = line.from + endIdx;
                        const prefixLen = color.length + 2;

                        if (isInsideMath(absStart)) continue;

                        decos.push({ from: absStart, to: absStart + prefixLen, deco: hideDeco });
                        decos.push({ from: absEnd - 2, to: absEnd, deco: hideDeco });
                        decos.push({ from: absStart + prefixLen, to: absEnd - 2, deco: Decoration.mark({ class: `bg-${color}` }) });
                    }
                }
                pos = line.to + 1;
                if (pos > view.state.doc.length) break;
            }
        }

        decos.sort((a, b) => a.from - b.from || a.to - b.to);
        let lastEnd = -1;
        for (const d of decos) {
            if (d.from >= lastEnd) {
                try {
                    builder.add(d.from, d.to, d.deco);
                    lastEnd = d.to;
                } catch (e) { console.warn("Overlapping deco", e); }
            }
        }
        return builder.finish();
    }
}, { decorations: v => v.decorations });

const liveTheme = EditorView.theme({
    "&": { backgroundColor: "transparent", height: "100%", color: "var(--text-main)" },
    ".cm-scroller": { fontFamily: "var(--p-font)", fontSize: "var(--p-size)", lineHeight: "1.6", padding: "40px 0" },
    ".cm-content": { paddingLeft: "20px", paddingRight: "20px", maxWidth: "850px", margin: "0 auto" },
    ".cm-heading1": { fontSize: "2.2rem", fontWeight: "800", display: "block", borderBottom: "1px solid var(--border-color)", marginBottom: "0.5em" },
    ".cm-heading2": { fontSize: "1.8rem", fontWeight: "700", display: "block" },
    ".cm-heading3": { fontSize: "1.4rem", fontWeight: "600", display: "block" },
    ".cm-line-center": { textAlign: "center" },
    ".cm-line-right": { textAlign: "right" },
    ".cm-poring-red": { color: "#ef4444" },
    ".cm-poring-blue": { color: "#3b82f6" },
    ".cm-poring-green": { color: "#10b981" },
    ".cm-poring-gray": { color: "#9ca3af" },
    ".cm-poring-orange": { color: "#f59e0b" },
    ".cm-poring-purple": { color: "#8b5cf6" },
    ".cm-poring-center, .cm-poring-right": { display: "inline" },
    ".cm-strong": { fontWeight: "bold" },
    ".cm-em": { fontStyle: "italic" },
    ".cm-strikethrough": { textDecoration: "line-through" },
    ".cm-highlight": { backgroundColor: "rgba(255, 212, 0, 0.4)", borderRadius: "3px", padding: "0 2px" },
    ".cm-inline-code": { backgroundColor: "rgba(128, 128, 128, 0.15)", color: "#c2185b", padding: "2px 4px", borderRadius: "4px", fontFamily: '"JetBrains Mono", monospace', fontSize: "0.9em" }
});

// 🚀 Move static configurations OUTSIDE the component
const liveMdExtension = markdown({ base: markdownLanguage, codeLanguages: languages });
const liveBasicSetup = { lineNumbers: false, foldGutter: false };

const LivePreviewEditor = ({ value, onChange, placeholder, editorViewRef }) => {

    // 🚀 Memoize the extensions array
    const extensions = useMemo(() => [
        liveMdExtension,
        EditorView.lineWrapping,
        livePreviewPlugin
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