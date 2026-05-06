import React, { useEffect } from 'react';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-markdown';
// You can import a prism theme here if you want basic coloring 
// but we will likely style it in CSS for a perfect match.
import 'prismjs/themes/prism.css';

// --- CUSTOM GRAMMAR: Poring Markdown ---
Prism.languages.poring = Prism.languages.extend('markdown', {});

Prism.languages.insertBefore('poring', 'prolog', {
    'poring-explanation': {
        pattern: /\[\[.+?\]\]\((?:[^()]+|\((?:[^()]+|\([^()]*\))*\))*\)/,
        greedy: true,
        alias: 'keyword'
    },
    'poring-color': {
        pattern: /(?:red|blue|green|orange|purple|gray)\[(?:[^\[\]]|\[[^\[\]]*\])*\]/,
        greedy: true,
        inside: {
            'poring-keyword': {
                pattern: /^(?:red|blue|green|orange|purple|gray)(?=\[)/,
                alias: 'keyword'
            },
            'punctuation': /[\[\]]/,
            'poring-color': {
                pattern: /(?:red|blue|green|orange|purple|gray)\[(?:[^\[\]]|\[[^\[\]]*\])*\]/,
                alias: 'important' // Highlight differently if nested
            },
            'poring-align': {
                pattern: /(?:center|right)\[(?:[^\[\]]|\[[^\[\]]*\])*\]/,
                alias: 'important'
            },
            'poring-function': {
                pattern: /\[today\]/,
                alias: 'important'
            }
        }
    },
    'poring-align': {
        pattern: /(?:center|right)\[(?:[^\[\]]|\[[^\[\]]*\])*\]/,
        greedy: true,
        inside: {
            'poring-keyword': {
                pattern: /^(?:center|right)(?=\[)/,
                alias: 'keyword'
            },
            'punctuation': /[\[\]]/,
            'poring-color': {
                pattern: /(?:red|blue|green|orange|purple|gray)\[(?:[^\[\]]|\[[^\[\]]*\])*\]/,
                alias: 'important'
            },
            'poring-align': {
                pattern: /(?:center|right)\[(?:[^\[\]]|\[[^\[\]]*\])*\]/,
                alias: 'important'
            },
            'poring-function': {
                pattern: /\[today\]/,
                alias: 'important'
            }
        }
    },
    'poring-function': {
        pattern: /\[today\]/,
        alias: 'keyword'
    },
    'poring-math': {
        pattern: /\$\$?[\s\S]*?\$?$/,
        alias: 'important'
    },
    'poring-indent': {
        pattern: /^[\s\.]*\.+/m,
        alias: 'comment'
    },
    'poring-pagebreak': {
        pattern: /^---$/m,
        alias: 'bold'
    },
    'poring-image-key': {
        pattern: /poring_img_\d+/,
        alias: 'url'
    }
});

const ColorfulEditor = ({ value, onChange, onPaste, placeholder, textareaRef }) => {

    useEffect(() => {
        if (textareaRef) {
            const el = document.getElementById('poring-editor-textarea');
            if (el) {
                textareaRef.current = el;
            }
        }
    }, [textareaRef]);

    const highlightWithLineNumbers = (input) => {
        return Prism.highlight(input, Prism.languages.poring, 'poring')
            .split('\n')
            .map((line, i) => `<span class="editorLineNumber">${i + 1}</span>${line}`)
            .join('\n');
    };

    return (
        <div className="colorful-editor-container">
            <Editor
                value={value}
                onValueChange={onChange}
                highlight={highlightWithLineNumbers}
                padding={20}
                placeholder={placeholder}
                className="colorful-editor"
                textareaId="poring-editor-textarea"
                onPaste={onPaste}
                style={{
                    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                    fontSize: 13.5,
                    minHeight: '100%',
                }}
            />
        </div>
    );
};

export default ColorfulEditor;
