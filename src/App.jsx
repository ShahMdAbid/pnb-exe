import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkFootnotes from 'remark-footnotes';
import remarkBreaks from 'remark-breaks';
// PDF export uses native browser print - no external library needed
import localforage from 'localforage';
import { saveAs } from 'file-saver';
import { exportPoringFile, importPoringFile } from './utils/poringFileHandler';
import ColorfulEditor from './components/ColorfulEditor';
import {
    Plus, FolderPlus, Folder, FileText, ChevronLeft, ChevronRight,
    Download, Trash2, Edit3, ChevronDown, Sun, Moon, Sparkles,
    Loader2, Settings, X, ClipboardCheck, PanelLeftClose, PanelLeftOpen,
    Bot, ExternalLink, Upload, Wand2, RotateCcw, Wrench, Palette, Scissors,
    AlignLeft, AlignCenter, AlignRight, Minus, Square, Columns, PenTool, Eye,
    Search, FilePlus // <--- ADD THESE NEW ICONS
} from 'lucide-react';
import 'katex/dist/katex.min.css';
import './App.css';
import guideContent from './guide.md?raw';

// --- HELPER: Database Persistence ---
const saveImageToDB = async (blob) => {
    const key = `poring_img_${Date.now()}`;
    await localforage.setItem(key, blob);
    return key;
};

import SustLogo from './assets/sust_logo.png';
import BegulaImg from './assets/Begula.png';

// --- HELPER: Asset Mapping (Obfuscation) ---
const ASSET_MAP = {
    SUST_LOGO: SustLogo,
    BEGULA_IMG: BegulaImg
};

// --- HELPER: Cover Page Templates ---
const COVER_TEMPLATES = {
    sust_eee: `center[#Shahjalal University of Science and Technology]
//1

![Image|200](SUST_LOGO)

//1

center[blue[##Department of Electrical & Electronic Engineering] ]
//1

center[###Course Title: ]
center[###Course Code:]
//1

center[red[###Lab Report / Assignment]]
//2

###Experiment no. : 
###**Experiment name**: 

| **Submitted By:** | **Submitted To:** |
| :---------------- | :---------------- |
| Name <br> Reg. No. :| Teacher's name  <br> Designation <br> Department |


center[####Submission date : [today]]

***
`
};

// --- HELPER: Exact Text Position Calculator ---
const getCaretCoordinates = (element, position) => {
    const div = document.createElement('div');
    const style = window.getComputedStyle(element);

    // Copy all font/layout properties strictly
    const properties = [
        'direction', 'boxSizing', 'overflowX', 'overflowY',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
        'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign',
        'textTransform', 'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing',
        'tabSize', 'MozTabSize', 'whiteSpace', 'wordWrap'
    ];

    properties.forEach(prop => {
        div.style[prop] = style[prop];
    });

    // CRITICAL: Force the clone to match the editor's inner width exactly
    div.style.width = `${element.clientWidth}px`;

    // Hide it but keep it in the DOM to measure
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.top = '0px';
    div.textContent = element.value.substring(0, position);

    // The span represents the cursor position
    const span = document.createElement('span');
    span.textContent = '|';
    div.appendChild(span);

    document.body.appendChild(div);
    const top = span.offsetTop + parseInt(style.borderTopWidth || 0);
    document.body.removeChild(div);

    return top;
};

// --- PDF CONFIGURATION ---
const PDF_CONFIG = {
    margin: 10, // mm
};

// --- STABLE COMPONENTS ---

const CustomImage = ({ src, alt }) => {
    const [imgSrc, setImgSrc] = useState(src);
    // Syntax: ![Alt|Width|Caption](url)
    const parts = alt ? alt.split('|') : ["Image"];
    const width = parts[1] || '400';
    const caption = parts[2] || null;

    useEffect(() => {
        let objectUrl = null;
        // Resolve from ASSET_MAP if keyword exists
        const resolvedSrc = ASSET_MAP[src] || src;

        if (resolvedSrc && resolvedSrc.startsWith('poring_img_')) {
            localforage.getItem(resolvedSrc).then(blob => {
                if (blob) {
                    objectUrl = URL.createObjectURL(blob);
                    setImgSrc(objectUrl);
                }
            }).catch(err => console.error("Error loading image from DB:", err));
        } else {
            setImgSrc(resolvedSrc);
        }

        return () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [src]);

    const imageElement = (
        <img
            src={imgSrc}
            alt={parts[0]}
            style={{ width: caption ? '100%' : `${width}px`, display: 'block', margin: '0 auto' }}
            className="resized-image"
        />
    );

    if (caption) {
        return (
            <figure style={{ display: 'block', margin: '1em auto', textAlign: 'center', width: `${width}px` }}>
                {imageElement}
                <figcaption className="image-caption">{caption}</figcaption>
            </figure>
        );
    }

    return imageElement;
};

const PageGuides = ({ contentRef }) => {
    const [guides, setGuides] = useState([]);

    useEffect(() => {
        let ro, mo;

        const calculateGuides = () => {
            if (!contentRef.current) return;
            const container = contentRef.current.querySelector('.page-container');
            if (!container) return;

            // 1. Core Dimensions
            const { width: containerWidthPx } = container.getBoundingClientRect();
            const pxPerMm = containerWidthPx / 210;
            const contentHeightPx = 257 * pxPerMm; // A4 printable height (roughly)
            const topPaddingPx = 20 * pxPerMm;

            // 2. Offsets
            const parentRect = contentRef.current.parentElement.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const containerTopOffset = (containerRect.top - parentRect.top) + contentRef.current.parentElement.scrollTop;

            // 3. Find all manual breaks
            const manualBreaks = Array.from(container.querySelectorAll('.manual-page-break')).map(el => {
                const rect = el.getBoundingClientRect();
                return rect.top - containerRect.top;
            }).sort((a, b) => a - b);

            const totalHeight = container.scrollHeight;
            const newGuides = [];
            let currentAnchor = topPaddingPx;
            let globalPageNum = 1;

            // 4. Interleaved Logical Loop
            while (true) {
                // Find if there's a manual break before the next auto break
                const nextAutoPos = currentAnchor + contentHeightPx;
                const manualBreak = manualBreaks.find(pos => pos > currentAnchor && pos <= nextAutoPos);

                if (manualBreak) {
                    // Manual break takes priority
                    newGuides.push({
                        position: containerTopOffset + manualBreak,
                        pageNumber: globalPageNum++,
                    });
                    currentAnchor = manualBreak; // Reset anchor to the manual break position
                } else if (nextAutoPos + 5 < totalHeight) {
                    // Standard automatic break
                    newGuides.push({
                        position: containerTopOffset + nextAutoPos,
                        pageNumber: globalPageNum++,
                    });
                    currentAnchor = nextAutoPos; // Reset anchor to the auto break position
                } else {
                    // Check if there are any remaining manual breaks after currentAnchor
                    const remainingManualBreak = manualBreaks.find(pos => pos > currentAnchor);
                    if (remainingManualBreak) {
                        newGuides.push({
                            position: containerTopOffset + remainingManualBreak,
                            pageNumber: globalPageNum++,
                        });
                        currentAnchor = remainingManualBreak;
                    } else {
                        break;
                    }
                }
            }
            setGuides(newGuides);
        };

        calculateGuides();

        ro = new ResizeObserver(calculateGuides);
        if (contentRef.current) ro.observe(contentRef.current);

        mo = new MutationObserver(calculateGuides);
        if (contentRef.current) {
            mo.observe(contentRef.current, { childList: true, subtree: true, characterData: true });
        }

        return () => {
            if (ro) ro.disconnect();
            if (mo) mo.disconnect();
        };
    }, [contentRef]);

    return (
        <div className="page-guides-container">
            {guides.map((guide, index) => (
                <div key={index} className="page-guide" style={{ top: `${guide.position}px` }}>
                    <div className="danger-zone" />
                    <div className="guide-line" />
                    <span className="guide-label">PAGE BREAK {guide.pageNumber}</span>
                </div>
            ))}
        </div>
    );
};

// Helper to inject line numbers ONLY if they exist
const SafeInject = ({ node, children, tagName, ...props }) => {
    const line = node?.position?.start?.line;
    const Component = tagName;
    const className = props.className || '';

    // If we have a line number, tag it.
    // We removed the isMath guard because top-level math containers (math math-display) 
    // should be sync targets, while deep KaTeX inners don't have node positions anyway.
    if (line) {
        return <Component {...props} data-source-line={line} className={`sync-target ${className}`}>{children}</Component>;
    }
    return <Component {...props}>{children}</Component>;
};

const MarkdownComponents = {
    img: CustomImage,
    a: (props) => <a {...props} className="styled-link" target="_blank" rel="noopener noreferrer" />,
    hr: () => null,

    // SAFE ELEMENTS TO TAG (Text & Lists)
    p: (props) => {
        const children = React.Children.toArray(props.children);
        const hasOnlyImage = children.length === 1 && children[0].props && children[0].type === CustomImage;

        if (hasOnlyImage) {
            return <div className="image-paragraph sync-target" data-source-line={props.node?.position?.start?.line}>{props.children}</div>;
        }
        return <SafeInject tagName="p" {...props} />;
    },
    h1: (props) => <SafeInject tagName="h1" {...props} />,
    h2: (props) => <SafeInject tagName="h2" {...props} />,
    h3: (props) => <SafeInject tagName="h3" {...props} />,
    h4: (props) => <SafeInject tagName="h4" {...props} />,
    blockquote: (props) => <SafeInject tagName="blockquote" {...props} />,
    li: (props) => <SafeInject tagName="li" {...props} />,
    pre: (props) => <SafeInject tagName="pre" {...props} />,

    // Support for custom syntax (colors, alignment, highlights)
    span: (props) => <SafeInject tagName="span" {...props} />,
    div: (props) => <SafeInject tagName="div" {...props} />,
    mark: (props) => <SafeInject tagName="mark" {...props} />,

    // Table elements (Bypass SafeInject to avoid layout breakage)
    table: (props) => <table {...props} />,
    thead: (props) => <thead {...props} />,
    tbody: (props) => <tbody {...props} />,
    tr: (props) => <tr {...props} />,
    th: (props) => <th {...props} />,
    td: (props) => <td {...props} />,

    // CRITICAL: DO NOT define div, span, or math components here.
    // Letting ReactMarkdown handle them natively prevents breaking KaTeX/MathJax.
};

// --- BLOCK PARSER ---
// DEPRECATED: We now use a single pass to preserve list contexts


const ABOUT_NOTE = {
    id: 'about-poring-notebook-v2',
    name: 'User guide & Changelog',
    content: guideContent
};

function App() {
    // Add a booting state
    const [isBooting, setIsBooting] = useState(true);

    // Initialize with empty arrays/defaults instead of localStorage
    const [notes, setNotes] = useState([ABOUT_NOTE]);
    const [folders, setFolders] = useState([]);
    const [activeNoteId, setActiveNoteId] = useState(ABOUT_NOTE.id);
    const [viewMode, setViewMode] = useState('split');
    const [searchQuery, setSearchQuery] = useState('');

    // --- PERFORMANCE UPGRADE: LOCAL EDITOR STATE & DEBOUNCE ---
    const [localContent, setLocalContent] = useState('');

    // 1. When the user clicks a different note, load its content into the local editor immediately
    useEffect(() => {
        const currentNote = notes.find(n => n.id === activeNoteId);
        setLocalContent(currentNote?.content || '');
    }, [activeNoteId, notes.length]); // Intentionally omitting 'notes' to prevent cursor jumping

    // 2. Debounce: Wait 300ms after typing stops before saving to the global notes array
    useEffect(() => {
        const handler = setTimeout(() => {
            const currentNote = notes.find(n => n.id === activeNoteId);
            if (currentNote && currentNote.content !== localContent) {
                updateContent(localContent);
            }
        }, 300);
        return () => clearTimeout(handler);
    }, [localContent, activeNoteId]);

    const handleDropNote = (e, targetFolderId) => {
        e.preventDefault();
        const noteId = e.dataTransfer.getData('noteId');
        if (!noteId) return;
        
        setNotes(prevNotes => prevNotes.map(n => 
            n.id === noteId ? { ...n, folderId: targetFolderId } : n
        ));
    };

    useEffect(() => {
        const loadAppData = async () => {
            try {
                const savedNotes = await localforage.getItem('poring_notes') || [];
                const savedFolders = await localforage.getItem('poring_folders') || [];
                const savedActiveId = await localforage.getItem('poring_active_note') || ABOUT_NOTE.id;

                const filtered = savedNotes.filter(n =>
                    !n.id.startsWith('about-poring-notebook') &&
                    n.id !== 'welcome-note-default'
                );
                
                setNotes([ABOUT_NOTE, ...filtered]);
                setFolders(savedFolders);
                setActiveNoteId(savedActiveId);
            } catch (error) {
                console.error("Failed to load data from IndexedDB", error);
            } finally {
                setIsBooting(false); // App is ready!
            }
        };
        loadAppData();
    }, []);
    
    // We need a ref to access the activeNoteId inside our clipboard listener without re-rendering
    const activeNoteIdRef = useRef(activeNoteId);
    useEffect(() => {
        activeNoteIdRef.current = activeNoteId;
    }, [activeNoteId]);
    
    const [lastRefinedContent, setLastRefinedContent] = useState(null);
    const [lastRefinedNoteId, setLastRefinedNoteId] = useState(null);
    const [canUndoRefine, setCanUndoRefine] = useState(false);
    const [toast, setToast] = useState({ message: '', visible: false });

    const showToast = (message) => {
        setToast({ message, visible: true });
        setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
    };

    // Force refresh About note whenever the code changes
    useEffect(() => {
        setNotes(prevNotes => {
            // Remove all About note versions
            const filtered = prevNotes.filter(n =>
                !n.id.startsWith('about-poring-notebook') &&
                n.id !== 'welcome-note-default'
            );
            // Inject fresh About note from code
            return [ABOUT_NOTE, ...filtered];
        });
    }, [ABOUT_NOTE.content]); // Re-run whenever About note content changes

    // Effect to mark welcome as seen simplified (no longer needed for injection but kept for compatibility)
    useEffect(() => {
        localStorage.setItem('poring_welcome_seen', 'true');
    }, []);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [expandedFolders, setExpandedFolders] = useState({});
    const [typography, setTypography] = useState(() => JSON.parse(localStorage.getItem('poring_typography')) || { font: 'Sans', size: 13 });
    const [spacing, setSpacing] = useState(localStorage.getItem('poring_spacing') || 'normal');
    const [imageWidths, setImageWidths] = useState(() => JSON.parse(localStorage.getItem('poring_image_widths')) || { pasted: 300, autoNote: 450 });
    const [theme, setTheme] = useState(localStorage.getItem('poring_theme') || 'dark');
    const [isSharing, setIsSharing] = useState(false);
    const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false);
    const [isCoverPagePickerOpen, setIsCoverPagePickerOpen] = useState(false);
    const [isRefining, setIsRefining] = useState(false);
    const [isBreakingMath, setIsBreakingMath] = useState(false);
    const imageInputRef = useRef(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [apiKeys, setApiKeys] = useState(() => {
        const saved = localStorage.getItem('groq_api_keys');
        return saved ? JSON.parse(saved) : ['', '', ''];
    });
    const [activeApiKeyIndex, setActiveApiKeyIndex] = useState(() => {
        const saved = localStorage.getItem('poring_active_api_key_index');
        return saved ? parseInt(saved, 10) : 0;
    });
    const [isCustomRefineOpen, setIsCustomRefineOpen] = useState(false);
    const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
    const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);
    
    // --- AUTO NOTE STATE ---
    const [isAutoNoteEnabled, setIsAutoNoteEnabled] = useState(false);
    const isAutoNoteEnabledRef = useRef(false);

    const toggleAutoNote = () => {
        const newState = !isAutoNoteEnabled;
        setIsAutoNoteEnabled(newState);
        isAutoNoteEnabledRef.current = newState;
        
        if (typeof window !== 'undefined' && window.electronAPI) {
            if (newState) {
                window.electronAPI.startClipboardListener();
                showToast("Auto-Note: Listening to clipboard");
            } else {
                window.electronAPI.stopClipboardListener();
                showToast("Auto-Note: Stopped listening");
            }
        }
    };
    
    const [customRefineText, setCustomRefineText] = useState('');
    const [savedCustomInstructions, setSavedCustomInstructions] = useState(() => {
        const saved = localStorage.getItem('poring_saved_custom_instructions');
        return saved ? JSON.parse(saved) : [];
    });
    const [customTemplates, setCustomTemplates] = useState(() => {
        const saved = localStorage.getItem('poring_custom_templates');
        return saved ? JSON.parse(saved) : [];
    });
    const [deleteConfirm, setDeleteConfirm] = useState(null); // { type: 'note'|'folder', id: string, name: string }
    const [showFolderPicker, setShowFolderPicker] = useState(false);

    const [promptState, setPromptState] = useState({ isOpen: false, message: '', defaultValue: '', resolve: null });

    const requestPrompt = (message, defaultValue = '') => {
        return new Promise((resolve) => {
            setPromptState({ isOpen: true, message, defaultValue, resolve });
        });
    };

    const handlePromptSubmit = (value) => {
        if (promptState.resolve) promptState.resolve(value);
        setPromptState({ isOpen: false, message: '', defaultValue: '', resolve: null });
    };

    const handlePromptCancel = () => {
        if (promptState.resolve) promptState.resolve(null);
        setPromptState({ isOpen: false, message: '', defaultValue: '', resolve: null });
    };

    const editorRef = useRef(null);
    const previewRef = useRef(null);

    // Persistence
    useEffect(() => {
        // DO NOT save if the app is still booting, or you will overwrite data with empty arrays!
        if (!isBooting) {
            localforage.setItem('poring_notes', notes);
            localforage.setItem('poring_folders', folders);
            localforage.setItem('poring_active_note', activeNoteId || '');
            
            // Settings are fine to stay in localStorage as they are very small
            localStorage.setItem('poring_typography', JSON.stringify(typography));
            localStorage.setItem('poring_spacing', spacing);
            localStorage.setItem('poring_theme', theme);
            localStorage.setItem('groq_api_keys', JSON.stringify(apiKeys));
            localStorage.setItem('poring_active_api_key_index', activeApiKeyIndex);
            localStorage.setItem('poring_custom_templates', JSON.stringify(customTemplates));
            localStorage.setItem('poring_saved_custom_instructions', JSON.stringify(savedCustomInstructions));
            localStorage.setItem('poring_image_widths', JSON.stringify(imageWidths));
        }
    }, [notes, folders, activeNoteId, typography, spacing, theme, apiKeys, activeApiKeyIndex, customTemplates, savedCustomInstructions, imageWidths, isBooting]);

    // Clipboard Listener Receiver
    useEffect(() => {
        if (typeof window !== 'undefined' && window.electronAPI) {
             window.electronAPI.onClipboardUpdate(async (payload) => {
                 if (!isAutoNoteEnabledRef.current) return;
                 
                 let appendText = '';
                 
                 if (payload.type === 'text') {
                     appendText = `\n\n${payload.text}\n\n`;
                 } else if (payload.type === 'image') {
                     try {
                         const response = await fetch(payload.dataURL);
                         const blob = await response.blob();
                         const key = await saveImageToDB(blob);
                         appendText = `\n\n![Image | ${imageWidths.autoNote}](${key})\n\n`;
                     } catch (e) {
                         console.error('Clipboard image error', e);
                         return; // Stop if failed
                     }
                 }

                 if (appendText) {
                     setLocalContent(prev => prev + appendText);
                 }
             });
        }
    }, []);

    const activeNote = notes.find(n => n.id === activeNoteId) || notes[0];

    // Actions
    const toggleFolder = (id) => {
        setExpandedFolders(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const createFolder = async () => {
        const name = await requestPrompt('Folder Name:');
        if (!name) return;
        setFolders([...folders, { id: Date.now().toString(), name }]);
    };

    const createNote = async (folderId = null) => {
        if (showFolderPicker) {
            setShowFolderPicker(false);
        }
        const name = await requestPrompt('Note name:', 'Untitled');
        if (!name) return;
        const newNote = { id: Date.now().toString(), name, content: '', folderId };
        setNotes([...notes, newNote]);
        setActiveNoteId(newNote.id);
    };

    const renameNote = async (id) => {
        if (id === ABOUT_NOTE.id) return; // Protected
        const note = notes.find(n => n.id === id);
        if (!note) return;
        const newName = await requestPrompt('Rename note:', note.name);
        if (!newName || newName === note.name) return;
        setNotes(notes.map(n => n.id === id ? { ...n, name: newName } : n));
    };

    const renameFolder = async (id) => {
        const folder = folders.find(f => f.id === id);
        if (!folder) return;
        const newName = await requestPrompt('Rename folder:', folder.name);
        if (!newName || newName === folder.name) return;
        setFolders(folders.map(f => f.id === id ? { ...f, name: newName } : f));
    };

    const confirmDelete = (type, id, name) => {
        setDeleteConfirm({ type, id, name });
    };

    const executeDelete = () => {
        if (!deleteConfirm) return;
        if (deleteConfirm.id === ABOUT_NOTE.id) {
            setDeleteConfirm(null);
            return;
        }
        if (deleteConfirm.type === 'note') {
            setNotes(notes.filter(n => n.id !== deleteConfirm.id));
            if (activeNoteId === deleteConfirm.id) setActiveNoteId(ABOUT_NOTE.id);
        } else if (deleteConfirm.type === 'folder') {
            setFolders(folders.filter(f => f.id !== deleteConfirm.id));
            // Optionally orphan or delete notes in this folder
            setNotes(notes.map(n => n.folderId === deleteConfirm.id ? { ...n, folderId: null } : n));
        }
        setDeleteConfirm(null);
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (isInsertMenuOpen && !event.target.closest('.insert-dropdown-container')) {
                setIsInsertMenuOpen(false);
            }
            if (isToolsMenuOpen && !event.target.closest('.tools-dropdown-container')) {
                setIsToolsMenuOpen(false);
                setIsColorMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isInsertMenuOpen, isToolsMenuOpen]);

    const updateContent = (content) => {
        setNotes(prevNotes => prevNotes.map(n => n.id === activeNoteId ? { ...n, content } : n));
    };

    const handleInsertPicture = () => {
        imageInputRef.current?.click();
        setIsInsertMenuOpen(false);
    };

    const handleInsertTable = async () => {
        const input = await requestPrompt("Table dimensions (e.g., 3x3):", "3x3");
        if (!input) return;

        const match = input.match(/(\d+)\s*[xX*]\s*(\d+)/);
        if (!match) {
            showToast("Invalid format. Use 3x3 or 3*3");
            return;
        }

        const rows = parseInt(match[1], 10);
        const cols = parseInt(match[2], 10);

        if (rows <= 0 || cols <= 0) {
            showToast("Dimensions must be positive");
            return;
        }

        let tableMd = "\n";
        // Header
        tableMd += "| " + Array(cols).fill("Header").join(" | ") + " |\n";
        // Separator
        tableMd += "| " + Array(cols).fill("---").join(" | ") + " |\n";
        // Rows
        for (let i = 0; i < rows; i++) {
            tableMd += "| " + Array(cols).fill("Cell").join(" | ") + " |\n";
        }
        tableMd += "\n";

        const textarea = editorRef.current;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const fullText = localContent;
        const newText = fullText.substring(0, start) + tableMd + fullText.substring(end);

        setLocalContent(newText);
        setIsInsertMenuOpen(false);
        showToast(`Inserted ${rows}x${cols} Table`);

        setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + tableMd.length;
            textarea.focus();
        }, 0);
    };

    const onImageFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const key = await saveImageToDB(file);
            const markdown = `![Image | ${imageWidths.pasted}](${key})`;
            const textarea = editorRef.current;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const newText = localContent.substring(0, start) + markdown + localContent.substring(end);
            setLocalContent(newText);
            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = start + markdown.length;
                textarea.focus();
            }, 0);
        } catch (err) {
            console.error("Image insert failed:", err);
            alert("Failed to insert image.");
        } finally {
            e.target.value = ''; // Reset for next time
        }
    };

    const handleInsertCoverPage = (key, isCustom = false) => {
        const template = isCustom
            ? customTemplates.find(t => t.id === key)?.content
            : COVER_TEMPLATES[key];

        if (!template) return;

        const content = localContent;
        const newText = template + content;
        setLocalContent(newText);
        setIsCoverPagePickerOpen(false);
        setIsInsertMenuOpen(false);
    };

    const handleSaveAsTemplate = async () => {
        const name = await requestPrompt('Template Name:');
        if (!name) return;

        const content = activeNote?.content || '';
        const newTemplate = {
            id: Date.now().toString(),
            name,
            content
        };

        setCustomTemplates([...customTemplates, newTemplate]);
        alert('Template saved successfully!');
    };

    const handleDeleteTemplate = (e, id) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this template?')) return;
        setCustomTemplates(customTemplates.filter(t => t.id !== id));
    };

    const handlePaste = async (e) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                try {
                    const key = await saveImageToDB(blob);
                    const markdown = `![Image | ${imageWidths.pasted}](${key})`;
                    const textarea = editorRef.current;
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;
                    const newText = localContent.substring(0, start) + markdown + localContent.substring(end);
                    setLocalContent(newText);
                    setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = start + markdown.length; }, 0);
                } catch (err) {
                    console.error("Paste failed:", err);
                }
            }
        }
    };

    // --- .PORING IMPORT/EXPORT SYSTEM ---
    const importInputRef = useRef(null);

    const handleExportPoring = async () => {
        if (!activeNote) return;
        await exportPoringFile(activeNote.name, activeNote.content);
    };

    const handleImportPoring = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const importedData = await importPoringFile(file);
        
        if (importedData) {
            const newNote = {
                id: `imported_${Date.now()}`,
                name: importedData.title,
                content: importedData.content,
                folderId: null
            };
            setNotes(prev => [...prev, newNote]);
            setActiveNoteId(newNote.id);
            showToast("Note imported successfully!");
        }
        
        e.target.value = ''; // Reset file input
    };

    const handleMagicRefine = async () => {
        // Use the selected API key
        const apiKey = apiKeys[activeApiKeyIndex];

        if (!apiKey || apiKey.trim() === '') {
            alert(`API Key ${activeApiKeyIndex + 1} is empty.Please select a valid key in Settings.`);
            setIsSettingsOpen(true);
            return;
        }

        const textarea = editorRef.current;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const fullText = localContent;
        const selectedText = fullText.substring(start, end);
        const textToRefine = selectedText || fullText;

        // Save for Undo
        setLastRefinedContent(fullText);
        setLastRefinedNoteId(activeNoteId);
        setCanUndoRefine(true);

        setIsRefining(true);
        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey} `,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        {
                            role: 'system',
                            content: `You are an Elite Academic Typesetter and LaTeX Specialist.

Your function is STRICTLY LIMITED to structural formatting and mathematical typesetting.

You are NOT allowed to rewrite, interpret, infer, complete, fix, or improve the content in any way.


### CRITICAL CORE DIRECTIVE(ABSOLUTE PRIORITY)

Preserve ALL original content EXACTLY, including:

- words
    - numbers
    - symbols
    - spacing
    - line breaks
        - wrappers
        - custom syntax
            - malformed expressions

DO NOT add, remove, reorder, or rewrite ANY content.

DO NOT infer missing symbols.

DO NOT correct mathematical logic.

DO NOT complete incomplete expressions.

If content is malformed or ambiguous, preserve it EXACTLY.

Your ONLY job is to apply proper LaTeX math delimiters and alignment formatting.

---

### TRANSFORMATION SCOPE(ONLY THESE ARE ALLOWED)

You MAY ONLY:

• Add inline math delimiters: $ ...$

• Add display math delimiters: $$ ...$$


• Insert alignment markers &

• Insert line breaks \\ inside aligned blocks

• Convert plain - text math into valid LaTeX math syntax


$$
\begin{ aligned }
...
...
\end{ aligned }
$$



---

### INLINE vs DISPLAY RULE

Use INLINE math($ ...$) when:

• expression is short
• expression is inside text
• single - line math

Use DISPLAY math($$ ...$$) when:

• expression is standalone
• multi - line derivation
• contains alignment steps

Display math MUST:
• every line MUST use & before =
• every line except last MUST end with \\
• vertical alignment MUST be preserved

Example:

Input:
x = y + z
= 10 + 5
= 15

Output:
$$
\begin{ aligned }
x &= y + z \\
&= 10 + 5 \\
&= 15
\end{ aligned }
$$



---

### WRAPPER INTEGRITY RULE(HIGHEST STRUCTURAL PRIORITY)

The following constructs are STRUCTURAL WRAPPERS used by the editor:

center[...]
right[...]
red[...]
blue[...]
green[...]
orange[...]
purple[...]
gray[...]
left[...]

++underline++

== highlight ==

    red == highlight ==

    //1
    //2
    //3
    etc.

These wrappers are NOT LaTeX.

They are NOT Markdown.

They are EDITOR STRUCTURE and MUST be preserved EXACTLY.

---

### STRICT WRAPPER PRESERVATION REQUIREMENTS

NEVER:

• remove wrappers
• rename wrappers
• relocate wrappers
• split wrappers
• wrap wrappers with $ or $$
• convert wrappers into LaTeX

WRAPPERS MUST REMAIN CHARACTER - FOR - CHARACTER IDENTICAL.

---

### MATH INSIDE WRAPPERS RULE

If math exists INSIDE a wrapper, convert ONLY the math, NOT the wrapper.

Correct example:

Input:
center[x = y + z]

Output:
center[$x = y + z$]

Correct example:

Input:
red[
    x = y + z
= 10
]

Output:
red[
    $$
\begin{ aligned }
x &= y + z \\
&= 10
\end{ aligned }
$$
]

WRAPPER stays untouched.ONLY internal math is converted.


### NEVER MOVE MATH OUTSIDE WRAPPERS

INVALID:
$$ center[x = y] $$

VALID:
center[$x = y$]

---


### CODE BLOCK PROTECTION RULE

If content appears inside, DO NOT modify ANYTHING inside.

### OUTPUT RULES(STRICT)

Return ONLY the refined Markdown.

DO NOT include explanations.

DO NOT include comments.

DO NOT include preamble or postscript.

DO NOT include conversational text.

OUTPUT ONLY the transformed content.

---

### HEADER SYNTAX RULE(SCALABLE LAYOUT)

NEVER use standard Markdown headers(#, ##, ###) for section titles by your own unless user uses #,##,### by himself, dont re invent, if exist let it stay.

    Use bold text (** Text **) for section titles otherwise.

This ensures font sizes scale correctly with user settings.

---

### FINAL EXECUTION PRIORITY ORDER

Priority 1 → Preserve wrappers EXACTLY
Priority 2 → Preserve ALL original content EXACTLY
Priority 3 → Apply math delimiters
Priority 4 → Apply alignment formatting

Wrappers ALWAYS override math formatting if conflict occurs.

NEVER violate wrapper integrity.`
                        },
                        { role: 'user', content: `Refine this note.Return only markdown: \n\n${textToRefine} ` }
                    ],
                    temperature: 0
                })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error.message);

            let refinedText = data.choices[0].message.content.trim();

            // SANITIZER: Remove markdown code fences if AI added them
            if (refinedText.startsWith('```')) {
                refinedText = refinedText.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
            }

            const newContent = selectedText
                ? fullText.substring(0, start) + refinedText + fullText.substring(end)
                : refinedText;

            setLocalContent(newContent);
        } catch (error) {
            alert('AI Refine failed: ' + error.message);
        } finally {
            setIsRefining(false);
        }
    };

    const handleCustomRefine = async () => {
        const apiKey = apiKeys[activeApiKeyIndex];
        if (!apiKey || apiKey.trim() === '') {
            alert(`API Key ${activeApiKeyIndex + 1} is empty. Please select a valid key in Settings.`);
            setIsSettingsOpen(true);
            return;
        }

        if (!customRefineText.trim()) {
            alert("Please enter custom instructions for refinement.");
            return;
        }

        const textarea = editorRef.current;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const fullText = localContent;
        const selectedText = fullText.substring(start, end);
        const textToRefine = selectedText || fullText;

        // Save for Undo
        setLastRefinedContent(fullText);
        setLastRefinedNoteId(activeNoteId);
        setCanUndoRefine(true);

        setIsRefining(true);
        setIsCustomRefineOpen(false);

        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        {
                            role: 'system',
                            content: `CRITICAL: You are a specialized Markdown Refinement Engine. 
Your ONLY task is to re-write the user's content according to their specific instruction.

### HEADER SYNTAX RULE:
NEVER use # or ## for headers unless user uses #,## by himself , dont re invent , if exist let it stay. ALWAYS wrap section titles in bold **Text** otherwise. This is for scalable font sizes.

### OUTPUT CONTRACT:
1. Return ONLY the refined markdown.
2. **ABSURDLY CRITICAL**: Do NOT include any part of these instructions, the ### RULES, or any meta-commentary in the output. If you see "### RULES" in your output, you have FAILED.
3. Preserve all custom notebook syntax: center[], right[], red[], blue[], green[], orange[], purple[], gray[].
4. Preserve all LaTeX math blocks: $...$ and $$...$$.
5. No preamble. No "Here is the refined text". No conversational filler.`
                        },
                        {
                            role: 'user',
                            content: `[USER INSTRUCTION]: "${customRefineText}"

[CONTENT TO REFINE]:
${textToRefine}

Refine the content above. Return ONLY the final markdown.`
                        }
                    ],
                    temperature: 0.2
                })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error.message);

            let refinedText = data.choices[0].message.content.trim();

            // Programmatic Safeguard: Strip any leaked Rules or Contract headers
            const headersToStrip = [/### OUTPUT CONTRACT/gi, /### RULES/gi, /\[USER INSTRUCTION\]/gi, /\[CONTENT TO REFINE\]/gi];
            headersToStrip.forEach(regex => {
                if (regex.test(refinedText)) {
                    // Try to extract only the actual content if multiple blocks were returned
                    // This is a safety measure if the AI repeats the input
                    const lastBrack = refinedText.lastIndexOf(']');
                    if (lastBrack !== -1 && lastBrack < refinedText.length / 2) {
                        refinedText = refinedText.substring(lastBrack + 1).trim();
                    } else {
                        refinedText = refinedText.replace(regex, '').trim();
                    }
                }
            });

            if (refinedText.startsWith('```')) {
                refinedText = refinedText.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
            }

            const newContent = selectedText
                ? fullText.substring(0, start) + refinedText + fullText.substring(end)
                : refinedText;

            setLocalContent(newContent);
        } catch (error) {
            alert('Custom Refine failed: ' + error.message);
        } finally {
            setIsRefining(false);
        }
    };

    const handleUndoRefine = () => {
        if (canUndoRefine && lastRefinedContent !== null && lastRefinedNoteId === activeNoteId) {
            updateContent(lastRefinedContent);
            setCanUndoRefine(false);
            setLastRefinedContent(null);
            setLastRefinedNoteId(null);
        }
    };

    const handleSaveCustomInstruction = () => {
        if (!customRefineText.trim()) return;
        if (savedCustomInstructions.includes(customRefineText.trim())) {
            alert("Instruction already saved.");
            return;
        }
        setSavedCustomInstructions([...savedCustomInstructions, customRefineText.trim()]);
    };

    const handleDeleteCustomInstruction = (e, index) => {
        e.stopPropagation();
        const newInstructions = [...savedCustomInstructions];
        newInstructions.splice(index, 1);
        setSavedCustomInstructions(newInstructions);
    };

    // --- TOOLS DROP-DOWN HELPERS ---
    const handleFormatting = (prefix, suffix) => {
        const textarea = editorRef.current;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const fullText = localContent;
        const selectedText = fullText.substring(start, end);

        const newText = prefix + selectedText + suffix;
        const updatedContent = fullText.substring(0, start) + newText + fullText.substring(end);

        setLocalContent(updatedContent);
        setIsToolsMenuOpen(false);
        setIsColorMenuOpen(false);

        // Reset selection
        setTimeout(() => {
            textarea.selectionStart = start;
            textarea.selectionEnd = start + newText.length;
            textarea.focus();
        }, 0);
    };

    const handleVerticalSpacing = async () => {
        const num = await requestPrompt("Enter number of lines for vertical spacing:", "1");
        if (num === null) return;
        const x = parseInt(num, 10);
        if (isNaN(x) || x < 1) {
            alert("Please enter a valid positive number.");
            return;
        }
        handleFormatting("", `\n//${x}\n`);
    };

    const handleBreakMathBlock = async () => {
        const textarea = editorRef.current;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const fullText = localContent;
        const selectedText = fullText.substring(start, end);

        // Check if selected text is a math block ($$ ... $$)
        if (!selectedText.trim().startsWith('$$') || !selectedText.trim().endsWith('$$')) {
            alert("Please select an entire math block (including $$ delimiters).");
            return;
        }

        const apiKey = apiKeys[activeApiKeyIndex];
        if (!apiKey) {
            alert('Please add a Groq API Key in Settings first.');
            setIsSettingsOpen(true);
            return;
        }

        const segmentsPrompt = await requestPrompt("Target number of segments to split this block into?", "2");
        if (segmentsPrompt === null) return;
        const segmentsNum = parseInt(segmentsPrompt, 10);
        if (isNaN(segmentsNum) || segmentsNum < 2) {
            alert("Please enter a number >= 2.");
            return;
        }

        setIsBreakingMath(true);
        setIsToolsMenuOpen(false);

        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a Mathematics Typesetting Specialist.

Your task is to take a single large LaTeX math block ($$ ... $$) and split it into multiple smaller, separate math blocks ($$ ... $$).

### CRITICAL RULES:
1. Preserve ALL mathematical logic and symbols exactly.
2. The user will specify a TARGET number of blocks. Aim to split the content into approximately that many blocks based on logical derivation steps.
3. If the content is an "aligned" environment (\\begin{aligned} ... \\end{aligned}), split it at the line breaks (\\\\) while keeping the alignment logic valid for each resulting block.
4. If a split result contains multiple lines of math, wrap them in a new \\begin{aligned} ... \\end{aligned} block inside the $$ tags if needed for alignment.
5. Every output block must be wrapped in $$ ... $$.
6. Add a single newline between the resulting blocks.
7. **OUTPUT ONLY THE MARKDOWN MODIFICATION**. Do not include explanations, preambles, or conversational text.

Example Input (Target: 3):
$$
\\begin{aligned}
x &= y + z \\\\
&= 10 + 5 \\\\
&= 15
\\end{aligned}
$$

Example Output:
$$
x = y + z
$$

$$
= 10 + 5
$$

$$
= 15
$$`
                        },
                        { role: 'user', content: `Split this math block into exactly ${segmentsNum} logical separate blocks:\n\n${selectedText}` }
                    ],
                    temperature: 0
                })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error.message);

            const result = data.choices[0].message.content.trim();
            const updatedContent = fullText.substring(0, start) + result + fullText.substring(end);
            setLocalContent(updatedContent);
        } catch (error) {
            console.error('Math Break Error:', error);
            alert('Failed to break math block: ' + error.message);
        } finally {
            setIsBreakingMath(false);
        }
    };

    // --- SYNC SCROLL LOGIC ---
    const handlePreviewClick = (e) => {
        // Fix Interaction Conflict: Prevent jump if user is selecting text
        if (window.getSelection().toString().length > 0) return;

        // 1. Find the clicked element (paragraph, header, etc.)
        const target = e.target.closest('[data-source-line]');
        if (!target) return;

        // 2. Find which PAGE container this element is inside
        const pageContainer = target.closest('.page-container');
        if (!pageContainer) return;

        // 3. Get the Local Line (Parser thinks every page starts at 1)
        const localLine = parseInt(target.getAttribute('data-source-line'), 10);

        // 5. Calculate the TRUE absolute line number (Sync logic simplified)
        // Since we are rendering the whole doc, data-source-line IS the absolute line.
        const trueLineNum = localLine;

        if (isNaN(trueLineNum) || !editorRef.current) return;

        const textarea = editorRef.current;
        const content = textarea.value;
        // 6. Calculate Character Index for that line (Robust Scanner for Windows \r\n)
        let startIndex = 0;
        let currentLine = 1;
        while (currentLine < trueLineNum && startIndex < content.length) {
            const nextNewline = content.indexOf('\n', startIndex);
            if (nextNewline === -1) break;
            startIndex = nextNewline + 1;
            currentLine++;
        }

        // Find end of line
        const endOfLine = content.indexOf('\n', startIndex);
        const endIndex = endOfLine === -1 ? content.length : endOfLine;

        // 7. Highlight the text in the editor
        textarea.focus();
        textarea.setSelectionRange(startIndex, endIndex);

        // 8. Scroll using the robust Pixel Calculator
        const pixelTop = getCaretCoordinates(textarea, startIndex);
        const container = textarea.closest('.colorful-editor-container');

        if (container) {
            const containerHeight = container.clientHeight;
            container.scrollTo({
                top: Math.max(0, pixelTop - (containerHeight / 2)),
                behavior: 'smooth'
            });
        }
    };

    const handleDownloadPDF = () => {
        const content = previewRef.current;
        if (!content) {
            alert('No content to export!');
            return;
        }

        // Change main document title so the browser's "Save as PDF" uses it as the filename
        const originalTitle = document.title;
        document.title = activeNote?.name || 'Document';

        const spacingMap = {
            'Too narrow': '0px',
            'narrow': '0.1em',
            'normal': '0.3em',
            'wide': '0.8em'
        };

        // ELECTRON NATIVE PDF GENERATION (SAFE IPC)
        if (typeof window !== 'undefined' && window.electronAPI) {

            const printStyle = document.createElement('style');
            printStyle.id = 'temp-print-style';
            printStyle.innerHTML = `
                @media print {
                    @page { size: A4; margin: 20mm; }

                    /* Hide everything except the preview pane */
                    header,
                    aside.sidebar,
                    section.editor-pane,
                    .preview-header,
                    .page-guides-container,
                    .page-footer,
                    .guide-label,
                    .danger-zone,
                    .guide-line,
                    .editor-info-bar,
                    .tools-dropdown-container,
                    .insert-dropdown-container {
                        display: none !important;
                    }

                    html, body, #root, .app-container {
                        background: white !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        overflow: visible !important;
                        height: auto !important;
                        min-height: 0 !important;
                        display: block !important;
                        position: static !important;
                    }

                    main.main-layout {
                        display: block !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        height: auto !important;
                        min-height: 0 !important;
                        overflow: visible !important;
                    }

                    section.preview-pane {
                        display: block !important;
                        width: 100% !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        border: none !important;
                        height: auto !important;
                        min-height: 0 !important;
                        overflow: visible !important;
                    }

                    .pages-stack {
                        display: block !important;
                        padding: 0 !important;
                        margin: 0 !important;
                    }

                    .preview-content,
                    .page-container {
                        width: 100% !important;
                        height: auto !important;
                        overflow: visible !important;
                        margin: 0 !important;
                        display: block !important;
                        border: none !important;
                        box-shadow: none !important;
                    }

                    .page-container {
                        page-break-after: auto;
                        break-after: auto;
                        padding: 0 !important;
                    }

                    .manual-page-break {
                        page-break-before: always !important;
                        break-before: page !important;
                        display: block !important;
                        height: 0 !important;
                        margin: 0 !important;
                        visibility: hidden !important;
                    }

                    img {
                        max-width: 100% !important;
                    }

                    :root {
                        --p-font: ${typography.font === 'Serif' ? "'Computer Modern Serif', serif" : typography.font === 'Mono' ? "'JetBrains Mono', monospace" : "'Inter', sans-serif"};
                        --p-size: ${typography.size}px;
                        --block-spacing: ${spacingMap[spacing] || '1em'};
                    }
                }
            `;
            document.head.appendChild(printStyle);

            const cleanupPrint = () => {
                document.title = originalTitle;
                const styleEl = document.getElementById('temp-print-style');
                if (styleEl) document.head.removeChild(styleEl);
                window.electronAPI.removeAllPrintListeners();
            };

            window.electronAPI.onPrintSuccess(() => cleanupPrint());
            window.electronAPI.onPrintError((err) => {
                alert('PDF generation failed: ' + err);
                cleanupPrint();
            });
            window.electronAPI.onPrintCancelled(() => cleanupPrint());

            // Pass null — Electron will print the LIVE window directly.
            // This is the ONLY way blob: image URLs are preserved in the PDF.
            window.electronAPI.printToPDF(null, activeNote?.name || 'Document');
            return;
        }


        // --- WEB BROWSER FALLBACK (IFRAME) ---
        // If Electron is not available, we fall back to the iframe method
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '1px'; // 1px ensures browser doesn't skip rendering fonts
        iframe.style.height = '1px';
        iframe.style.opacity = '0';
        iframe.style.pointerEvents = 'none';
        iframe.style.border = '0';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow.document;

        let styles = document.head.innerHTML;
        styles = styles.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

        styles += `
            <style>
            @page {
                size: A4;
                margin: 20mm;
            }
            body {
                background: white;
                margin: 0;
                padding: 0;
                overflow: visible!important;
                height: auto!important;
            }
            .preview-content, .page-container {
                width: 100%!important;
                height: auto!important;
                overflow: visible!important;
                margin: 0!important;
                display: block!important;
            }
            .page-container {
                page-break-after: auto;
                break-after: auto;
                padding: 0!important;
            }
            .manual-page-break {
                page-break-before: always!important;
                break-before: page!important;
                display: block!important;
                height: 0!important;
                margin: 0!important;
                visibility: hidden!important;
            }
            .page-guides-container, .page-footer, .guide-label, .danger-zone, .guide-line {
                display: none!important;
            }
            :root {
                --p-font: ${typography.font === 'Serif' ? "'Computer Modern Serif', serif" : typography.font === 'Mono' ? "'JetBrains Mono', monospace" : "'Inter', sans-serif"};
                --p-size: ${typography.size}px;
                --block-spacing: ${spacingMap[spacing] || '1em'};
            }
            </style>
        `;

        const htmlString = `
        <!DOCTYPE html>
            <html>
                <head>${styles}</head>
                <body>
                    ${content.outerHTML}
                </body>
            </html>
        `;


        // WEB BROWSER FALLBACK (IFRAME)
        // 5. Write content to iframe
        // Setup onload BEFORE doc.write to guarantee it fires
        iframe.onload = () => {
            const win = iframe.contentWindow;
            // First wait a brief moment for external CSS (like KaTeX) to parse
            setTimeout(() => {
                let printed = false;
                const executePrint = () => {
                    if (printed) return;
                    printed = true;
                    // Finally, give layout engines 500ms to calculate sizes and positions
                    setTimeout(() => {
                        win.focus();
                        try { win.print(); } catch (e) { }

                        // Cleanup
                        document.title = originalTitle; // Restore original title immediately after print dialog closes
                        setTimeout(() => {
                            if (document.body.contains(iframe)) {
                                document.body.removeChild(iframe);
                            }
                        }, 500);
                    }, 500);
                };

                // Then wait for all fonts to finish loading
                win.document.fonts.ready.then(executePrint);
                // Fallback timeout in case fonts.ready hangs indefinitely (prevents black screen)
                setTimeout(executePrint, 2500);
            }, 500);
        };

        doc.open();
        doc.write(htmlString);
        doc.close();
    };


    const spacingMap = {
        'Too narrow': '0px',
        'narrow': '0.1em',
        'normal': '0.3em',
        'wide': '0.8em'
    };

    // --- PERFORMANCE UPGRADE: MEMOIZED REGEX PARSER ---
    const processedMarkdown = React.useMemo(() => {
        let c = activeNote?.content || '';
        if (!c) return '';

        const placeholders = [];
        const mask = (text, type) => {
            const lineCount = (text.match(/\n/g) || []).length;
            const key = `@@${type}_${placeholders.length}@@`;
            const padding = '\n'.repeat(lineCount);
            placeholders.push({ key, text, padding });
            return key + padding;
        };

        c = c.replace(/(`{3,})([\s\S]*?)\1/g, (match) => mask(match, 'CODE_BLOCK'));
        c = c.replace(/(`)([\s\S]*?)\1/g, (match) => mask(match, 'INLINE_CODE'));
        c = c.replace(/(\$\$)([\s\S]*?)\1/g, (match) => mask(match, 'BLOCK_MATH'));
        c = c.replace(/(\$)(?!\s)([^$\n]+?)(?<!\s)\1/g, (match) => mask(match, 'INLINE_MATH'));

        const explanations = new Map();
        c = c.replace(/:::explain\s+(.+?)\n([\s\S]*?)\n:::/g, (match, keyword, content) => {
            explanations.set(keyword.trim(), content.trim());
            const lineCount = (match.match(/\n/g) || []).length;
            return '\n'.repeat(lineCount); 
        });

        const inlineExplainRegex = /\[\[(.+?)\]\]\(/g;
        let m;
        while ((m = inlineExplainRegex.exec(c)) !== null) {
            const keyword = m[1];
            const start = m.index;
            const openParenIndex = start + m[0].length - 1;
            let depth = 1;
            let j = openParenIndex + 1;
            while (j < c.length && depth > 0) {
                if (c[j] === '(') depth++;
                else if (c[j] === ')') depth--;
                j++;
            }
            if (depth === 0) {
                const content = c.substring(openParenIndex + 1, j - 1);
                if (!explanations.has(keyword.trim())) {
                    explanations.set(keyword.trim(), content.trim());
                }
                const lineCount = (content.match(/\n/g) || []).length;
                const replacement = `[[${keyword}]]` + '\n'.repeat(lineCount);
                c = c.substring(0, start) + replacement + c.substring(j);
                inlineExplainRegex.lastIndex = start + replacement.length;
            }
        }

        const todayStr = new Intl.DateTimeFormat('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka'
        }).format(new Date());

        c = c.split('\n').map((line, index) => {
            const lineNum = index + 1;
            let processedLine = line;
            processedLine = processedLine.replace(/\[today\]/g, todayStr);
            const hMatch = processedLine.match(/^([\s\.]*(?:(?:red|blue|green|orange|purple|gray|center|right|left)\[\s*)*)(#+)/);
            if (hMatch) {
                const prefix = hMatch[1];
                const hashes = hMatch[2];
                const rest = processedLine.substring(hMatch[0].length);
                processedLine = hashes + ' ' + prefix + rest;
            }
            processedLine = processedLine.replace(/^([#\s]*?)(\.+)/, (match, prefix, dots) => {
                return prefix + '&nbsp;'.repeat(dots.length * 2);
            });
            const vMatch = processedLine.match(/^(\s*)\/\/(\d+)(\s*)$/);
            if (vMatch) {
                const prefix = vMatch[1];
                const num = parseInt(vMatch[2], 10);
                return `<div class="sync-target v-space" data-source-line="${lineNum}">${(prefix + '&nbsp;<br/>').repeat(num)}</div>`;
            }
            if (/^\s*\*\*\*\s*$/.test(processedLine)) {
                return `<div class="manual-page-break sync-target" data-source-line="${lineNum}"></div>`;
            }
            return processedLine;
        }).join('\n');

        const tags = ['red', 'blue', 'green', 'orange', 'purple', 'gray', 'center', 'right', 'left'];
        const applyBalanced = (text) => {
            const regex = new RegExp(`(${tags.join('|')})\\[`, 'g');
            let match;
            while ((match = regex.exec(text)) !== null) {
                const tag = match[1];
                const start = match.index;
                const open = start + tag.length;
                let depth = 1, j = open + 1;
                while (j < text.length && depth > 0) {
                    if (text[j] === '[') depth++;
                    else if (text[j] === ']') depth--;
                    j++;
                }
                if (depth === 0) {
                    const inner = text.substring(open + 1, j - 1);
                    const processedInner = applyBalanced(inner);
                    const replacement = `<span class="${tag}">${processedInner}</span>`;
                    text = text.substring(0, start) + replacement + text.substring(j);
                    regex.lastIndex = 0; 
                } else {
                    regex.lastIndex = open + 1; 
                }
            }
            return text;
        };

        c = applyBalanced(c);
        c = c.replace(/\+\+([\s\S]*?)\+\+/g, '<span class="underline">$1</span>');

        const highlightColors = ['red', 'blue', 'green', 'orange', 'purple', 'gray'];
        highlightColors.forEach(cls => {
            const regex = new RegExp(`${cls}==([\\s\\S]*?)==`, 'g');
            c = c.replace(regex, `<mark class="bg-${cls}">$1</mark>`);
        });
        c = c.replace(/==([\s\S]*?)==/g, '<mark>$1</mark>');

        const keywordCounters = {};
        c = c.replace(/\[\[(.+?)\]\]/g, (match, keyword) => {
            const normalized = keyword.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            if (!keywordCounters[normalized]) keywordCounters[normalized] = 0;
            keywordCounters[normalized]++;
            const counter = keywordCounters[normalized];
            return `<span id="origin_${normalized}_${counter}"></span><a href="#explain_${normalized}" class="keyword-ref">${keyword.trim()}</a>`;
        });

        if (explanations.size > 0) {
            let section = '\n\n<hr>\n\n<div class="explanation-section">';
            explanations.forEach((content, keyword) => {
                const normalized = keyword.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                section += `\n<div id="explain_${normalized}" class="explanation">`;
                section += `\n\n**${keyword.trim()}**\n\n${content}\n\n`;
                section += `<a href="#origin_${normalized}_1" class="back-link">&larr; Back</a>`;
                section += `\n</div>`;
            });
            section += '\n</div>';
            c += section;
        }

        placeholders.reverse().forEach(p => {
            c = c.split(p.key + p.padding).join(p.text);
        });
        
        return c;
    }, [activeNote?.content]);

    if (isBooting) return <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', background: '#1e1e1e' }}>Loading Poring Notebook...</div>;

    return (
        <div className={`app-container ${theme === 'dark' ? 'dark-theme' : ''}`} style={{
            '--p-font': typography.font === 'Serif' ? "'Computer Modern Serif', serif" : typography.font === 'Mono' ? "'JetBrains Mono', monospace" : "'Inter', sans-serif",
            '--p-size': `${typography.size}px`,
            '--block-spacing': spacingMap[spacing] || '1em'
        }}>
            <header className="header">
                <div className="header-left">
                    <button className="btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
                        {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
                    </button>
                    <div className="logo" style={{ marginLeft: '10px' }}>Poring Notebook</div>
                </div>

                {/* --- NEW VIEW TOGGLES --- */}
                <div className="view-toggles no-drag">
                    <button 
                        className={`btn-view ${viewMode === 'editor' ? 'active' : ''}`} 
                        onClick={() => setViewMode('editor')} title="Editor Only">
                        <PenTool size={14} /> Write
                    </button>
                    <button 
                        className={`btn-view ${viewMode === 'split' ? 'active' : ''}`} 
                        onClick={() => setViewMode('split')} title="Split View">
                        <Columns size={14} /> Split
                    </button>
                    <button 
                        className={`btn-view ${viewMode === 'preview' ? 'active' : ''}`} 
                        onClick={() => setViewMode('preview')} title="Preview Only">
                        <Eye size={14} /> Read
                    </button>
                </div>

                <div className="header-right">
                    <button className="btn no-drag" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
                        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
                    </button>
                    <button className="btn no-drag" onClick={() => setIsSettingsOpen(true)}>
                        <Settings size={18} />
                    </button>
                    
                    {/* --- WINDOW CONTROLS --- */}
                    {window.electronAPI && window.electronAPI.windowMinimize && (
                        <div className="window-controls no-drag">
                            <button className="window-btn" onClick={() => window.electronAPI.windowMinimize()}>
                                <Minus size={16} />
                            </button>
                            <button className="window-btn" onClick={() => window.electronAPI.windowMaximize()}>
                                <Square size={14} />
                            </button>
                            <button className="window-btn close" onClick={() => window.electronAPI.windowClose()}>
                                <X size={18} />
                            </button>
                        </div>
                    )}
                </div>
            </header>

            <main className="main-layout">
                <aside 
                    className={`sidebar ${isSidebarOpen ? '' : 'collapsed'}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDropNote(e, null)} // Drop on empty space to remove from folder
                >
                    <div className="sidebar-header">
                        <div className="sidebar-action-row">
                            <button className="sidebar-icon-btn" onClick={() => createNote()} title="New Note">
                                <FilePlus size={16} />
                            </button>
                            <button className="sidebar-icon-btn" onClick={() => createFolder()} title="New Folder">
                                <FolderPlus size={16} />
                            </button>
                            <button className="sidebar-icon-btn" onClick={() => importInputRef.current?.click()} title="Import .poring">
                                <Upload size={16} />
                            </button>
                            <input type="file" ref={importInputRef} style={{ display: 'none' }} accept=".poring" onChange={handleImportPoring} />
                        </div>
                        
                        <div className="sidebar-search">
                            <Search size={14} className="search-icon" />
                            <input 
                                type="text" 
                                placeholder="Search notes..." 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="sidebar-scroll">
                        {searchQuery.trim() !== '' ? (
                            /* SEARCH RESULTS (Flat List) */
                            notes.filter(n => n.name.toLowerCase().includes(searchQuery.toLowerCase())).map(note => (
                                <div key={note.id} className={`note-item ${activeNoteId === note.id ? 'active' : ''}`} onClick={() => setActiveNoteId(note.id)}>
                                    <FileText size={14} /> <span>{note.name}</span>
                                </div>
                            ))
                        ) : (
                            /* NORMAL FOLDER STRUCTURE */
                            <>
                                {folders.map(folder => {
                                    const isExpanded = expandedFolders[folder.id];
                                    return (
                                        <div 
                                            key={folder.id} 
                                            className="folder-group"
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => { e.stopPropagation(); handleDropNote(e, folder.id); }}
                                        >
                                            <div className="note-item folder-title" onClick={() => toggleFolder(folder.id)}>
                                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                <Folder size={14} /> <span>{folder.name}</span>
                                                <div className="item-actions">
                                                    <Plus size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); createNote(folder.id); }} title="Add note" />
                                                    <Edit3 size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); renameFolder(folder.id); }} title="Rename" />
                                                    <Trash2 size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); confirmDelete('folder', folder.id, folder.name); }} title="Delete" />
                                                </div>
                                            </div>
                                            {isExpanded && notes.filter(n => n.folderId === folder.id).map(note => (
                                                <div 
                                                    key={note.id} 
                                                    draggable
                                                    onDragStart={(e) => e.dataTransfer.setData('noteId', note.id)}
                                                    className={`note-item child-note ${activeNoteId === note.id ? 'active' : ''}`} 
                                                    onClick={() => setActiveNoteId(note.id)}
                                                >
                                                    <FileText size={14} /> <span>{note.name}</span>
                                                    {note.id !== ABOUT_NOTE.id && (
                                                        <div className="item-actions">
                                                            <Edit3 size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); renameNote(note.id); }} title="Rename" />
                                                            <Trash2 size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); confirmDelete('note', note.id, note.name); }} title="Delete" />
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                                
                                {/* UNCATEGORIZED NOTES */}
                                {notes.filter(n => !n.folderId).map(note => (
                                    <div 
                                        key={note.id} 
                                        draggable={note.id !== ABOUT_NOTE.id}
                                        onDragStart={(e) => e.dataTransfer.setData('noteId', note.id)}
                                        className={`note-item ${activeNoteId === note.id ? 'active' : ''}`} 
                                        onClick={() => setActiveNoteId(note.id)}
                                    >
                                        <FileText size={14} /> <span>{note.name}</span>
                                        {note.id !== ABOUT_NOTE.id && (
                                            <div className="item-actions">
                                                <Edit3 size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); renameNote(note.id); }} title="Rename" />
                                                <Trash2 size={12} className="hover-icon" onClick={(e) => { e.stopPropagation(); confirmDelete('note', note.id, note.name); }} title="Delete" />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </aside>

                {/* CONDITIONAL EDITOR PANE */}
                {(viewMode === 'split' || viewMode === 'editor') && (
                    <section className="editor-pane" style={viewMode === 'editor' ? { borderRight: 'none' } : {}}>
                        <div className="editor-info-bar">
                            <span>{activeNote?.name || 'No Note Selected'}</span>
                            {isRefining && <span className="refining-status"><Loader2 className="spin" size={14} /> Refining...</span>}

                            {isCoverPagePickerOpen && (
                                <div className="cover-picker-overlay" onClick={() => setIsCoverPagePickerOpen(false)}>
                                    <div className="cover-picker-modal" onClick={e => e.stopPropagation()}>
                                        <div className="modal-header">
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <h3>Choose a Cover Page</h3>
                                                <p style={{ fontSize: '0.8rem', color: '#666', margin: 0 }}>Presets or your saved templates</p>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <button className="btn-save-tpl" onClick={handleSaveAsTemplate}>
                                                    <Plus size={14} /> Save Current as Template
                                                </button>
                                                <X size={20} className="close-btn" onClick={() => setIsCoverPagePickerOpen(false)} />
                                            </div>
                                        </div>

                                        <div className="template-scroll-area">
                                            <div className="template-section">
                                                <h4>Standard Presets</h4>
                                                <div className="template-grid">
                                                    <div className="template-card" onClick={() => handleInsertCoverPage('sust_eee')}>
                                                        <div className="template-preview academic">
                                                            <div className="line school"></div>
                                                            <div className="line title"></div>
                                                            <div className="line author"></div>
                                                        </div>
                                                        <span>SUST EEE Cover</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {customTemplates.length > 0 && (
                                                <div className="template-section" style={{ marginTop: '24px' }}>
                                                    <h4>My Templates</h4>
                                                    <div className="template-grid">
                                                        {customTemplates.map(tpl => (
                                                            <div key={tpl.id} className="template-card" onClick={() => handleInsertCoverPage(tpl.id, true)}>
                                                                <div className="template-preview custom">
                                                                    <div className="tpl-delete-btn" onClick={(e) => handleDeleteTemplate(e, tpl.id)}>
                                                                        <Trash2 size={12} />
                                                                    </div>
                                                                    <div className="tpl-content-hint">
                                                                        {tpl.content.substring(0, 100)}...
                                                                    </div>
                                                                </div>
                                                                <span>{tpl.name}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="ai-buttons-group">
                                <div className="tools-dropdown-container">
                                    <button
                                        className={`btn-insert ${isToolsMenuOpen ? 'active' : ''}`}
                                        onClick={() => setIsToolsMenuOpen(!isToolsMenuOpen)}
                                        disabled={!activeNote}
                                        title="Tools"
                                    >
                                        <Wrench size={14} />
                                        <ChevronDown size={14} className={`arrow ${isToolsMenuOpen ? 'up' : ''}`} />
                                    </button>

                                    {isToolsMenuOpen && (
                                        <div className="insert-menu tools-menu">
                                            <div className="insert-option" onClick={() => handleFormatting("**", "**")}>
                                                <span>Bold</span>
                                            </div>
                                            <div className="insert-option" onClick={() => handleFormatting("*", "*")}>
                                                <span>Italic</span>
                                            </div>
                                            <div className="insert-option" onClick={() => handleFormatting("++", "++")}>
                                                <span>Underline</span>
                                            </div>
                                            <div className="insert-option" onClick={() => handleFormatting("~~", "~~")}>
                                                <span>Strikethrough</span>
                                            </div>
                                            <div className="insert-option" onClick={() => handleFormatting("==", "==")}>
                                                <span>Highlight</span>
                                            </div>
                                            <div className="insert-option" onClick={() => handleFormatting("center[", "]")}>
                                                <AlignCenter size={14} />
                                                <span>Center Align</span>
                                            </div>
                                            <div className="insert-option" onClick={() => handleFormatting("", "\n---\n")}>
                                                <span>Page Break</span>
                                            </div>

                                            <div
                                                className="insert-option sub-menu-trigger"
                                                onMouseEnter={() => setIsColorMenuOpen(true)}
                                                onMouseLeave={() => setIsColorMenuOpen(false)}
                                            >
                                                <Palette size={14} />
                                                <span>Color</span>
                                                <ChevronRight size={14} style={{ marginLeft: 'auto' }} />

                                                {isColorMenuOpen && (
                                                    <div className="insert-menu color-submenu">
                                                        {['Red', 'Blue', 'Green', 'Orange', 'Purple', 'Gray'].map(clr => (
                                                            <div
                                                                key={clr}
                                                                className="insert-option"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleFormatting(`${clr.toLowerCase()}[`, "]");
                                                                }}
                                                            >
                                                                <div className={`color-dot bg-${clr.toLowerCase()}`} />
                                                                <span>{clr}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="insert-option" onClick={handleVerticalSpacing}>
                                                <span>Vertical Spacing</span>
                                            </div>
                                            <div className="insert-option" onClick={handleBreakMathBlock}>
                                                {isBreakingMath ? <Loader2 className="spin" size={14} /> : <Scissors size={14} />}
                                                <span>{isBreakingMath ? 'Breaking...' : 'Break Math Block'}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="insert-dropdown-container">
                                    <button
                                        className={`btn-insert ${isInsertMenuOpen ? 'active' : ''}`}
                                        onClick={() => setIsInsertMenuOpen(!isInsertMenuOpen)}
                                        disabled={!activeNote}
                                    >
                                        <Plus size={14} />
                                        <span>Insert</span>
                                        <ChevronDown size={14} className={`arrow ${isInsertMenuOpen ? 'up' : ''}`} />
                                    </button>

                                    {isInsertMenuOpen && (
                                        <div className="insert-menu">
                                            <div className="insert-option" onClick={handleInsertPicture}>
                                                <span>Picture</span>
                                            </div>
                                            <div className="insert-option" onClick={handleInsertTable}>
                                                <span>Table</span>
                                            </div>
                                            <div className="insert-option" onClick={() => { setIsCoverPagePickerOpen(true); setIsInsertMenuOpen(false); }}>
                                                <span>Cover Page</span>
                                            </div>
                                        </div>
                                    )}
                                    <input
                                        type="file"
                                        ref={imageInputRef}
                                        style={{ display: 'none' }}
                                        accept="image/*"
                                        onChange={onImageFileChange}
                                    />
                                </div>
                                <button 
                                    className={`btn-auto-note ${isAutoNoteEnabled ? 'active' : ''}`} 
                                    onClick={toggleAutoNote} 
                                    disabled={!activeNote} 
                                    title={isAutoNoteEnabled ? "Auto-Note: ON (Listening to Clipboard)" : "Auto-Note: OFF"}
                                    style={{ 
                                        background: isAutoNoteEnabled ? '#10b981' : 'transparent', 
                                        color: isAutoNoteEnabled ? 'white' : 'inherit',
                                        border: '1px solid #444', 
                                        padding: '4px 8px', 
                                        borderRadius: '4px', 
                                        cursor: 'pointer', 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '4px',
                                        transition: 'all 0.3s ease'
                                    }}
                                >
                                    <ClipboardCheck size={14} /> 
                                    {isAutoNoteEnabled && <span style={{fontSize: '10px', fontWeight: 'bold'}}>LISTENING</span>}
                                </button>
                                {canUndoRefine && lastRefinedNoteId === activeNoteId && (
                                    <button className="btn-undo-refine" onClick={handleUndoRefine} title="Undo AI Change">
                                        <RotateCcw size={14} />
                                    </button>
                                )}
                                <button className="btn-custom-refine" onClick={() => setIsCustomRefineOpen(true)} disabled={isRefining || !activeNote} title="Custom Refine">
                                    <Wand2 size={14} />
                                </button>
                                <button className={`btn-magic ${isRefining ? 'loading' : ''}`} onClick={handleMagicRefine} disabled={isRefining || !activeNote} title="Enhance Syntax">
                                    {isRefining ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                                </button>
                            </div>
                        </div>
                        <ColorfulEditor
                            value={localContent}
                            onChange={setLocalContent}
                            onPaste={handlePaste}
                            placeholder="Start typing..."
                            textareaRef={editorRef}
                        />
                    </section>
                )}

                {/* CONDITIONAL PREVIEW PANE */}
                {(viewMode === 'split' || viewMode === 'preview') && (
                    <section className="preview-pane">
                        <div className="preview-header">
                            <span>PDF Preview</span>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button className="btn-export" onClick={handleExportPoring} disabled={!activeNote} title="Export as .poring file">
                                    <Download size={14} /> .poring
                                </button>
                                <button className="btn-export" onClick={handleDownloadPDF} disabled={!activeNote} title="Export as PDF">
                                    <Download size={14} /> PDF
                                </button>
                            </div>
                        </div>
                        <div className="pages-stack">
                            <PageGuides contentRef={previewRef} />
                            <div className="preview-content" ref={previewRef} onClick={handlePreviewClick}>
                                <div className="page-container markdown-body">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath, remarkFootnotes, remarkBreaks]}
                                        rehypePlugins={[rehypeRaw, [rehypeKatex, { strict: false }]]}
                                        components={MarkdownComponents}
                                        urlTransform={(url) => url}
                                    >
                                        {processedMarkdown}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        </div>
                    </section>
                )}
            </main>

            {
                isSettingsOpen && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>Groq API Settings</h3>
                            <div className="api-keys-list">
                                {apiKeys.map((key, idx) => (
                                    <div key={idx} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                        <input
                                            type="radio"
                                            name="selectedApiKey"
                                            checked={activeApiKeyIndex === idx}
                                            onChange={() => setActiveApiKeyIndex(idx)}
                                            style={{ width: 'auto', margin: 0, cursor: 'pointer' }}
                                            title={`Use API Key ${idx + 1} `}
                                        />
                                        <div className="api-key-input-group" style={{ flex: 1 }}>
                                            <label>API Key {idx + 1}</label>
                                            <input
                                                type="password"
                                                value={key}
                                                onChange={(e) => {
                                                    const newKeys = [...apiKeys];
                                                    newKeys[idx] = e.target.value;
                                                    setApiKeys(newKeys);
                                                }}
                                                placeholder={`gsk_key_0${idx + 1}...`}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="modal-section" style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #333' }}>
                                <h4>Editor & Image Settings</h4>
                                <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '10px' }}>
                                    <div className="setting-item">
                                        <label>Pasted Image Width (px)</label>
                                        <input
                                            type="number"
                                            value={imageWidths.pasted}
                                            onChange={(e) => setImageWidths({ ...imageWidths, pasted: parseInt(e.target.value) || 300 })}
                                        />
                                    </div>
                                    <div className="setting-item">
                                        <label>Auto-Note Image Width (px)</label>
                                        <input
                                            type="number"
                                            value={imageWidths.autoNote}
                                            onChange={(e) => setImageWidths({ ...imageWidths, autoNote: parseInt(e.target.value) || 450 })}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="modal-section" style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid var(--border-color)' }}>
                                <h4 style={{ marginBottom: '10px', fontSize: '0.85rem', color: 'var(--accent)', textTransform: 'uppercase' }}>Typography & Spacing</h4>
                                <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                    <div className="setting-item" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Font Family</label>
                                        <select
                                            value={typography.font}
                                            onChange={(e) => setTypography({ ...typography, font: e.target.value })}
                                            style={{ padding: '8px', background: 'var(--bg-modal-input)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                                        >
                                            <option value="Sans">Modern (Sans)</option>
                                            <option value="Serif">LaTeX (Standard)</option>
                                            <option value="Mono">Code (Mono)</option>
                                        </select>
                                    </div>
                                    <div className="setting-item" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Line Spacing</label>
                                        <select
                                            value={spacing}
                                            onChange={(e) => setSpacing(e.target.value)}
                                            style={{ padding: '8px', background: 'var(--bg-modal-input)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                                        >
                                            <option value="Too narrow">Too narrow</option>
                                            <option value="narrow">Narrow</option>
                                            <option value="normal">Normal</option>
                                            <option value="wide">Wide</option>
                                        </select>
                                    </div>
                                    <div className="setting-item" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Font Size (px)</label>
                                        <input
                                            type="number"
                                            value={typography.size}
                                            onChange={(e) => setTypography({ ...typography, size: parseInt(e.target.value) })}
                                            style={{ padding: '8px' }}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="modal-btns">
                                <a
                                    href="https://console.groq.com/keys"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn-get-api"
                                >
                                    <ExternalLink size={14} /> Get API Key
                                </a>
                                <div style={{ flex: 1 }} />
                                <button onClick={() => setIsSettingsOpen(false)}>Close</button>
                                <button className="btn-primary" onClick={() => setIsSettingsOpen(false)}>Save</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {
                deleteConfirm && (
                    <div className="modal-overlay">
                        <div className="modal-content">
                            <h3>Confirm Delete</h3>
                            <p>Are you sure you want to delete <strong>"{deleteConfirm.name}"</strong>?</p>
                            {deleteConfirm.type === 'folder' && <p style={{ color: '#ff6b6b', fontSize: '0.9rem' }}>Notes in this folder will be moved to Uncategorized.</p>}
                            <div className="modal-btns">
                                <button onClick={() => setDeleteConfirm(null)}>Cancel</button>
                                <button className="btn-danger" onClick={executeDelete}>Delete</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {isCustomRefineOpen && (
                <div className="modal-overlay" onClick={() => setIsCustomRefineOpen(false)}>
                    <div className="modal-content custom-refine-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Custom Refine</h3>
                            <X size={20} className="close-btn" onClick={() => setIsCustomRefineOpen(false)} />
                        </div>

                        <div className="custom-refine-body">
                            <label className="modal-label">Instruction</label>
                            <textarea
                                value={customRefineText}
                                onChange={(e) => setCustomRefineText(e.target.value)}
                                placeholder="e.g., Break this math block into 2 smaller one, Change tone to academic..."
                                className="custom-refine-textarea"
                            />

                            <div className="modal-btns" style={{ marginTop: '12px' }}>
                                <button className="btn-secondary" onClick={handleSaveCustomInstruction} title="Save current instruction as a preset">
                                    <Plus size={14} /> Save Preset
                                </button>
                                <div style={{ flex: 1 }} />
                                <button className="btn-primary" onClick={handleCustomRefine}>
                                    <Sparkles size={14} /> Refine
                                </button>
                            </div>

                            {savedCustomInstructions.length > 0 && (
                                <div className="custom-refine-presets">
                                    <label className="modal-label">Presets</label>
                                    <div className="presets-list">
                                        {savedCustomInstructions.map((instr, idx) => (
                                            <div key={idx} className="preset-item" onClick={() => setCustomRefineText(instr)}>
                                                <span className="preset-text">{instr}</span>
                                                <div className="preset-actions">
                                                    <Trash2 size={12} className="preset-delete" onClick={(e) => handleDeleteCustomInstruction(e, idx)} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {promptState.isOpen && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>Prompt</h3>
                        <p>{promptState.message}</p>
                        <input
                            type="text"
                            autoFocus
                            defaultValue={promptState.defaultValue}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handlePromptSubmit(e.target.value);
                                if (e.key === 'Escape') handlePromptCancel();
                            }}
                            id="custom-prompt-input"
                            style={{ width: '100%', padding: '8px', marginTop: '10px', marginBottom: '15px' }}
                        />
                        <div className="modal-btns">
                            <button onClick={handlePromptCancel}>Cancel</button>
                            <button className="btn-primary" onClick={() => handlePromptSubmit(document.getElementById('custom-prompt-input').value)}>OK</button>
                        </div>
                    </div>
                </div>
            )}

            {toast.visible && (
                <div className="toast-container">
                    <div className="toast-message">
                        {toast.message}
                    </div>
                </div>
            )}
        </div>

    );
}

export default App;
