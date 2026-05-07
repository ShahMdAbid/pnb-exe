import React, { useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView, Decoration, MatchDecorator, ViewPlugin } from '@codemirror/view';

// Custom theme to make it seamlessly match your Light/Dark mode CSS variables
const poringTheme = EditorView.theme({
    "&": {
        backgroundColor: "transparent",
        height: "100%",
        color: "var(--text-main)"
    },
    ".cm-scroller": {
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: "14px",
        lineHeight: "1.6",
        padding: "20px 0"
    },
    "&.cm-focused": {
        outline: "none" // Removes the ugly default blue outline
    },
    ".cm-gutters": {
        backgroundColor: "transparent",
        borderRight: "1px solid var(--border-color)",
        color: "#888",
        minWidth: "45px",
        paddingRight: "5px"
    },
    ".cm-content": {
        paddingLeft: "10px",
        paddingRight: "25px"
    },
    // --- CUSTOM PORING COLORS ---
    ".cm-poring-keyword": { color: "#b91c1c", fontWeight: "bold" },
    ".cm-poring-spacer": { color: "#888", fontStyle: "italic" },
    ".cm-poring-math": { color: "#d32f2f", backgroundColor: "rgba(0,0,0,0.03)", borderRadius: "3px" },
    ".cm-poring-explanation": { color: "#3b82f6", textDecoration: "underline" }
});

// Creates a blazing fast regex highlighter that only runs on visible text
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

const ColorfulEditor = ({ value, onChange, onPaste, placeholder, editorViewRef }) => {

    // We intercept the DOM paste event and pass it to your App.jsx handlePaste
    const domEventHandlers = EditorView.domEventHandlers({
        paste: (event, view) => {
            if (onPaste) {
                // We pass the native event so your e.clipboardData.items still works!
                onPaste(event);
            }
        }
    });

    return (
        <div className="colorful-editor-container" style={{ flex: 1, height: '100%', minHeight: 0, display: 'flex' }}>
            <CodeMirror
                value={value}
                height="100%" // <--- ADDED THIS to make it fill the container
                style={{ flex: 1, overflow: 'auto' }} // <--- ADDED THIS to enable scrolling
                onChange={(val) => onChange(val)}
                theme={poringTheme}
                extensions={[
                    markdown({ base: markdownLanguage, codeLanguages: languages }),
                    domEventHandlers,
                    EditorView.lineWrapping,
                    // --- INJECT CUSTOM HIGHLIGHTERS ---
                    createMatchPlugin(/\b(red|blue|green|orange|purple|gray|center|right|left)(?=\[)/g, "cm-poring-keyword"),
                    createMatchPlugin(/\[today\]/g, "cm-poring-keyword"),
                    createMatchPlugin(/^\s*\/\/\d+/gm, "cm-poring-spacer"),
                    createMatchPlugin(/\$[^$\n]+\$/g, "cm-poring-math"),
                    createMatchPlugin(/\[\[.*?\]\]\(.*?\)/g, "cm-poring-explanation")
                ]}
                placeholder={placeholder}
                basicSetup={{
                    lineNumbers: true,
                    highlightActiveLineGutter: false,
                    highlightActiveLine: false,
                    foldGutter: false,
                    dropCursor: true,
                    crosshairCursor: false,
                }}
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