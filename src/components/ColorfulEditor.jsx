import React, { useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView, Decoration, MatchDecorator, ViewPlugin } from '@codemirror/view';

const poringTheme = EditorView.theme({
    "&": { backgroundColor: "transparent", height: "100%", color: "var(--text-main)" },
    ".cm-scroller": { fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: "14px", lineHeight: "1.6", padding: "20px 0" },
    "&.cm-focused": { outline: "none" },
    ".cm-gutters": { backgroundColor: "transparent", borderRight: "1px solid var(--border-color)", color: "#888", minWidth: "45px", paddingRight: "5px" },
    ".cm-content": { paddingLeft: "10px", paddingRight: "25px" },
    ".cm-poring-keyword": { color: "#b91c1c", fontWeight: "bold" },
    ".cm-poring-spacer": { color: "#888", fontStyle: "italic" },
    ".cm-poring-inline-math": { color: "#d32f2f", backgroundColor: "rgba(211,47,47,0.05)", borderRadius: "3px", padding: "0 2px" },
    ".cm-poring-block-math": { color: "#1976d2", backgroundColor: "rgba(25,118,210,0.05)", borderRadius: "4px", fontWeight: "bold" },
    ".cm-poring-explanation": { color: "#3b82f6", textDecoration: "underline" }
});

function createMatchPlugin(regex, className) {
    const decorator = new MatchDecorator({
        regexp: regex,
        decoration: Decoration.mark({ class: className })
    });
    return ViewPlugin.fromClass(
        class {
            constructor(view) { this.decorations = decorator.createDeco(view); }
            update(update) { 
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = decorator.createDeco(update.view); 
                }
            }
        },
        { decorations: v => v.decorations }
    );
}

// 🚀 OPTIMIZATION 1: Instantiate these heavy plugins OUTSIDE the component so they are created only ONCE.
const mdExtension = markdown({ base: markdownLanguage, codeLanguages: languages });
const blockMathPlugin = createMatchPlugin(/\$\$[\s\S]*?\$\$/g, "cm-poring-block-math");
const inlineMathPlugin = createMatchPlugin(/(?<!\$)\$[^$\n]+\$(?!\$)/g, "cm-poring-inline-math");

// 🚀 OPTIMIZATION 2: Make basicSetup a stable reference outside the component
const editorBasicSetup = {
    lineNumbers: true,
    highlightActiveLineGutter: false,
    highlightActiveLine: false,
    foldGutter: false,
    dropCursor: true,
    crosshairCursor: false,
};

const ColorfulEditor = ({ value, onChange, onPaste, placeholder, editorViewRef }) => {
    
    // 🚀 OPTIMIZATION 3: Keep a stable ref to onPaste to avoid re-triggering useMemo below
    const onPasteRef = useRef(onPaste);
    useEffect(() => {
        onPasteRef.current = onPaste;
    }, [onPaste]);

    // 🚀 OPTIMIZATION 4: Memoize the extensions array so CodeMirror doesn't reconfigure on every keystroke
    const extensions = useMemo(() => {
        return [
            mdExtension,
            EditorView.lineWrapping,
            blockMathPlugin,
            inlineMathPlugin,
            EditorView.domEventHandlers({
                paste: (event, view) => {
                    if (onPasteRef.current) {
                        onPasteRef.current(event);
                    }
                }
            })
        ];
    }, []);

    return (
        <div className="colorful-editor-container" style={{ flex: 1, height: '100%', minHeight: 0, display: 'flex' }}>
            <CodeMirror
                value={value}
                height="100%" 
                style={{ flex: 1, overflow: 'auto' }} 
                onChange={(val) => onChange(val)}
                theme={poringTheme}
                extensions={extensions} 
                placeholder={placeholder}
                basicSetup={editorBasicSetup}
                onCreateEditor={(view) => {
                    if (editorViewRef) {
                        editorViewRef.current = view;
                    }
                }}
            />
        </div>
    );
};

export default ColorfulEditor;