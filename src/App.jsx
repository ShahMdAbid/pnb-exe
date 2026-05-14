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
import LivePreviewEditor from './components/LivePreviewEditor';
import { EditorView } from '@codemirror/view';
import {
    Plus, FolderPlus, Folder, FileText, ChevronLeft, ChevronRight,
    Download, Trash2, Edit3, ChevronDown, Sun, Moon, Sparkles,
    Loader2, Settings, X, ClipboardCheck, PanelLeftClose, PanelLeftOpen,
    Bot, ExternalLink, Upload, Wand2, RotateCcw, Wrench, Palette, Scissors,
    AlignLeft, AlignCenter, AlignRight, Minus, Square, Columns, PenTool, Eye,
    Search, FilePlus, Bold, Italic, Underline, Strikethrough, Highlighter, Pen,
    Monitor
} from 'lucide-react';
import DrawMode from './components/DrawMode';
import 'katex/dist/katex.min.css';
import './App.css';
import guideContent from './guide.md?raw';
import {
    processAiRequest,
    MAGIC_REFINE_PROMPT,
    CUSTOM_REFINE_SYSTEM_PROMPT,
    BREAK_MATH_PROMPT,
    CLIPBOARD_FIXER_PROMPT
} from './utils/aiService';

// --- HELPER: Database Persistence ---
// --- NATIVE ASSET MANAGER ---
const saveImageToAssetStore = async (fileOrBlob) => {
    const ext = fileOrBlob.type.includes('png') ? 'png' : 'jpg';
    const filename = `img_${Date.now()}.${ext}`;

    // 1. NATIVE ELECTRON PATH (Ultra Fast)
    if (window.electronAPI && window.electronAPI.saveAsset) {
        // Just send the raw ArrayBuffer. Electron handles the conversion.
        const arrayBuffer = await fileOrBlob.arrayBuffer();
        await window.electronAPI.saveAsset(filename, arrayBuffer);
        return `poring-asset://${filename}`;
    }

    // 2. LEGACY WEB FALLBACK
    const key = `poring_img_${Date.now()}`;
    const buffer = await fileOrBlob.arrayBuffer();
    const pureBlob = new Blob([buffer], { type: fileOrBlob.type || 'image/png' });
    await localforage.setItem(key, pureBlob);
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



// --- PDF CONFIGURATION ---
const PDF_CONFIG = {
    margin: 10, // mm
};

// --- STABLE COMPONENTS ---

const CustomImage = ({ src, alt }) => {
    const [imgSrc, setImgSrc] = useState(src);
    const parts = alt ? alt.split('|') : ["Image"];
    const width = parts[1] || '400';
    const caption = parts[2] || null;

    useEffect(() => {
        let objectUrl = null;
        const resolvedSrc = ASSET_MAP[src] || src;

        if (resolvedSrc && resolvedSrc.startsWith('poring-asset://')) {
            // NATIVE PATH: Let the browser engine handle it directly! No memory leaks.
            setImgSrc(resolvedSrc);
        } else if (resolvedSrc && resolvedSrc.startsWith('poring_img_')) {
            // LEGACY PATH: Fallback for older notes
            localforage.getItem(resolvedSrc).then(blob => {
                if (blob) {
                    objectUrl = URL.createObjectURL(blob);
                    setImgSrc(objectUrl);
                }
            }).catch(err => console.error("Error loading legacy image:", err));
        } else {
            setImgSrc(resolvedSrc);
        }
        
        return () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [src]);

    const handleDoubleClick = () => {
        if (src.startsWith('poring_img_') || src.startsWith('poring-asset://')) {
            window.dispatchEvent(new CustomEvent('request-image-edit', { detail: src }));
        }
    };

    const imageElement = (
        <img
            src={imgSrc}
            alt={parts[0]}
            // Removed display: block so flexbox can align it side-by-side
            style={{ width: caption ? '100%' : `${width}px`, cursor: 'pointer', maxWidth: '100%', height: 'auto', borderRadius: '4px' }}
            className="resized-image"
            onDoubleClick={handleDoubleClick}
            title="Double click to edit in Draw Mode"
        />
    );

    if (caption) {
        return (
            <figure style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: 0, width: `${width}px`, maxWidth: '100%' }}>
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
                    <span className="guide-label">{guide.pageNumber}</span>
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
    p: (props) => {
        const children = React.Children.toArray(props.children);

        // Find all images and non-images in this paragraph
        const images = children.filter(child => child.props && child.type === CustomImage);
        const nonImages = children.filter(child => !(child.props && child.type === CustomImage));

        // Check if the non-image content is just empty space/newlines
        const hasOnlyImagesAndWhitespace = nonImages.every(child => typeof child === 'string' && child.trim() === '');

        if (images.length > 0 && hasOnlyImagesAndWhitespace) {
            return (
                <div
                    className="image-gallery sync-target"
                    data-source-line={props.node?.position?.start?.line}
                    // This Flexbox wrapper allows multiple images to sit side-by-side centered!
                    style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', flexWrap: 'wrap', margin: '1.5em 0' }}
                >
                    {props.children}
                </div>
            );
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
    span: (props) => <SafeInject tagName="span" {...props} />,
    div: (props) => <SafeInject tagName="div" {...props} />,
    mark: (props) => <SafeInject tagName="mark" {...props} />,
    table: (props) => <table {...props} />,
    thead: (props) => <thead {...props} />,
    tbody: (props) => <tbody {...props} />,
    tr: (props) => <tr {...props} />,
    th: (props) => <th {...props} />,
    td: (props) => <td {...props} />,
};

// --- BLOCK PARSER ---
// DEPRECATED: We now use a single pass to preserve list contexts


const ABOUT_NOTE = {
    id: 'about-poring-notebook-v2',
    name: 'User guide & Changelog',
    content: guideContent
};

const GEMINI_MODELS = [
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' }
];

function App() {
    // Add a booting state
    const [isBooting, setIsBooting] = useState(true);

    // Initialize with empty arrays/defaults instead of localStorage
    const [notes, setNotes] = useState([ABOUT_NOTE]);
    const [folders, setFolders] = useState([]);
    const [activeNoteId, setActiveNoteId] = useState(ABOUT_NOTE.id);
    const [viewMode, setViewMode] = useState('split');
    const [searchQuery, setSearchQuery] = useState('');
    const [drawModeState, setDrawModeState] = useState({ isOpen: false, editKey: null });

    // Listen for Double Click from Preview
    useEffect(() => {
        const handleImageEdit = (e) => {
            setDrawModeState({ isOpen: true, editKey: e.detail });
        };
        window.addEventListener('request-image-edit', handleImageEdit);
        return () => window.removeEventListener('request-image-edit', handleImageEdit);
    }, []);

    // Function to open Draw Mode based on Editor Cursor
    const handleOpenDrawMode = () => {
        const view = editorRef.current;
        if (!view) return;

        const { from, to } = view.state.selection.main;
        const line = view.state.doc.lineAt(from);

        // Check if cursor is on a line with an image tag
        const imageRegex = /!\[.*?\]\(((?:poring-asset:\/\/img_|poring_img_).*?)\)/;
        const match = line.text.match(imageRegex);

        if (match) {
            // Edit existing image from editor cursor
            setDrawModeState({ isOpen: true, editKey: match[1] });
        } else {
            // Open blank draw mode
            setDrawModeState({ isOpen: true, editKey: null });
        }
        setIsInsertMenuOpen(false); // Close dropdown if it was open
    };

    // Function that fires when "Save" is clicked inside DrawMode
    const handleSaveDrawing = (newKey, oldKey) => {
        const view = editorRef.current;

        if (oldKey) {
            // We were editing an existing image. Find and replace its key in the document.
            // We replace it globally in the localContent string so it updates everywhere.
            setLocalContent(prev => prev.replace(oldKey, newKey));
        } else if (view) {
            // We created a brand new drawing. Insert it at cursor position.
            const markdown = `\n![Image | ${imageWidths.pasted}](${newKey})\n`;
            const { from, to } = view.state.selection.main;
            view.dispatch({
                changes: { from, to, insert: markdown },
                selection: { anchor: from + markdown.length }
            });
            view.focus();
        }

        setDrawModeState({ isOpen: false, editKey: null });
    };

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
                // 1. TRY NATIVE LOAD FIRST
                let workspace = null;
                if (window.electronAPI && window.electronAPI.loadWorkspace) {
                    workspace = await window.electronAPI.loadWorkspace();
                }

                if (workspace && workspace.notes && workspace.notes.length > 0) {
                    // NATIVE LOAD SUCCESSFUL
                    setNotes([ABOUT_NOTE, ...workspace.notes]);
                    setFolders(workspace.folders || []);
                    setActiveNoteId(workspace.activeNoteId || ABOUT_NOTE.id);
                } else {
                    // 2. LEGACY WEB FALLBACK & MIGRATION
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

                    // AUTO-MIGRATION: Save these old DB notes straight to the OS Native Folder!
                    if (window.electronAPI && window.electronAPI.syncWorkspace && filtered.length > 0) {
                        await window.electronAPI.syncWorkspace({ notes: filtered, folders: savedFolders, activeNoteId: savedActiveId });
                        console.log("Auto-Migrated IndexedDB notes to Native OS Folder!");
                    }
                }
            } catch (error) {
                console.error("Failed to load data", error);
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
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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
        return saved ? JSON.parse(saved) : [''];
    });
    const [activeApiKeyIndex, setActiveApiKeyIndex] = useState(() => {
        const saved = localStorage.getItem('poring_active_api_key_index');
        return saved ? parseInt(saved, 10) : 0;
    });
    const [aiProvider, setAiProvider] = useState(() => localStorage.getItem('poring_ai_provider') || 'gemini');
    const [updateStatus, setUpdateStatus] = useState('');
    useEffect(() => {
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onUpdateMessage) {
            window.electronAPI.onUpdateMessage((msg) => setUpdateStatus(msg));
        }
    }, []);
    const handleCheckUpdate = () => {
        if (window.electronAPI && window.electronAPI.checkForUpdates) {
            window.electronAPI.checkForUpdates();
        } else {
            setUpdateStatus('Updates not supported in web mode.');
        }
    };
    // New Multi-key Gemini State (with fallback migration for old users)
    const [geminiKeys, setGeminiKeys] = useState(() => {
        const saved = localStorage.getItem('poring_gemini_keys');
        if (saved) return JSON.parse(saved);
        const legacy = localStorage.getItem('poring_gemini_key');
        return legacy ? [legacy] : [''];
    });
    const [activeGeminiIndex, setActiveGeminiIndex] = useState(() => {
        const saved = localStorage.getItem('poring_active_gemini_index');
        return saved ? parseInt(saved, 10) : 0;
    });
    const [geminiModel, setGeminiModel] = useState(() => localStorage.getItem('poring_gemini_model') || 'gemini-2.5-flash-lite');

    // AI Clipboard Filter State
    const [isAiClipboardEnabled, setIsAiClipboardEnabled] = useState(false);
    const isAiClipboardEnabledRef = useRef(false);

    const toggleAiClipboard = () => {
        const newState = !isAiClipboardEnabled;
        setIsAiClipboardEnabled(newState);
        isAiClipboardEnabledRef.current = newState;
        showToast(newState ? "AI Clipboard Fixer: ON" : "AI Clipboard Fixer: OFF");
    };

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

    const aiConfigRef = useRef({ aiProvider, geminiKeys, activeGeminiIndex, geminiModel, apiKeys, activeApiKeyIndex });
    useEffect(() => {
        aiConfigRef.current = { aiProvider, geminiKeys, activeGeminiIndex, geminiModel, apiKeys, activeApiKeyIndex };
    }, [aiProvider, geminiKeys, activeGeminiIndex, geminiModel, apiKeys, activeApiKeyIndex]);
    useEffect(() => {
        if (!isBooting) {
            if (window.electronAPI && window.electronAPI.syncWorkspace) {
                // --- NATIVE SAVE ---
                // We strip out the internal About Note so it doesn't clutter the disk
                const filteredNotes = notes.filter(n => !n.id.startsWith('about-poring-notebook') && n.id !== 'welcome-note-default');
                window.electronAPI.syncWorkspace({ notes: filteredNotes, folders, activeNoteId });
            } else {
                // --- LEGACY WEB SAVE ---
                localforage.setItem('poring_notes', notes);
                localforage.setItem('poring_folders', folders);
                localforage.setItem('poring_active_note', activeNoteId || '');
            }

            // Keep lightweight settings in localStorage
            localStorage.setItem('poring_typography', JSON.stringify(typography));
            localStorage.setItem('poring_spacing', spacing);
            localStorage.setItem('poring_theme', theme);
            localStorage.setItem('groq_api_keys', JSON.stringify(apiKeys));
            localStorage.setItem('poring_active_api_key_index', activeApiKeyIndex);
            localStorage.setItem('poring_custom_templates', JSON.stringify(customTemplates));
            localStorage.setItem('poring_saved_custom_instructions', JSON.stringify(savedCustomInstructions));
            localStorage.setItem('poring_image_widths', JSON.stringify(imageWidths));
            localStorage.setItem('poring_ai_provider', aiProvider);
            localStorage.setItem('poring_gemini_keys', JSON.stringify(geminiKeys));
            localStorage.setItem('poring_active_gemini_index', activeGeminiIndex);
            localStorage.setItem('poring_gemini_model', geminiModel);
        }
    }, [notes, folders, activeNoteId, typography, spacing, theme, apiKeys, activeApiKeyIndex, customTemplates, savedCustomInstructions, imageWidths, aiProvider, geminiKeys, activeGeminiIndex, geminiModel, isBooting]);

    // Clipboard Listener Receiver
    useEffect(() => {
        if (typeof window !== 'undefined' && window.electronAPI) {
            window.electronAPI.onClipboardUpdate(async (payload) => {
                if (!isAutoNoteEnabledRef.current) return;
                
                let appendText = '';
                if (payload.type === 'text') {
                    const rawText = payload.text;
                    if (isAiClipboardEnabledRef.current) {
                        showToast("AI is cleaning clipboard text...");
                        const { aiProvider: provider, geminiKeys: gKeys, activeGeminiIndex: gIdx, geminiModel: gModel, apiKeys: groqKeys, activeApiKeyIndex: groqIdx } = aiConfigRef.current;
                        const config = {
                            provider: provider,
                            apiKey: provider === 'gemini' ? gKeys[gIdx] : groqKeys[groqIdx],
                            model: provider === 'gemini' ? gModel : 'llama-3.3-70b-versatile',
                            systemInstruction: CLIPBOARD_FIXER_PROMPT,
                            prompt: rawText,
                            temperature: 0.1
                        };
                        try {
                            const cleanedText = await processAiRequest(config);
                            appendText = `\n${cleanedText}\n`;
                            showToast("Clipboard fixed and added!");
                        } catch (err) {
                            console.error("AI Clipboard Fix failed:", err);
                            showToast("AI Fix failed. Adding raw text.");
                            appendText = `\n${rawText}\n`; 
                        }
                    } else {
                        appendText = `\n${rawText}\n`;
                    }
                } else if (payload.type === 'image') {
                    try {
                        const response = await fetch(payload.dataURL);
                        const blob = await response.blob();
                        const key = await saveImageToAssetStore(blob);
                        appendText = `\n![Image | ${imageWidths.autoNote}](${key})\n`;
                    } catch (e) {
                        console.error('Clipboard image error', e);
                        return;
                    }
                }

                if (appendText) {
                    const view = editorRef.current;
                    // If an editor view is active, insert at cursor. Otherwise, append to end.
                    if (view) {
                        const { from } = view.state.selection.main;
                        view.dispatch({
                            changes: { from, insert: appendText },
                            selection: { anchor: from + appendText.length }
                        });
                        view.focus();
                    } else {
                        setLocalContent(prev => prev + appendText);
                    }
                }
            });
        }
    }, [imageWidths.autoNote]); // Listener attached once on mount

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
            if (isToolsMenuOpen && !event.target.closest('.format-toolbar-container')) {
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
        tableMd += "| " + Array(cols).fill("Header").join(" | ") + " |\n";
        tableMd += "| " + Array(cols).fill("---").join(" | ") + " |\n";
        for (let i = 0; i < rows; i++) {
            tableMd += "| " + Array(cols).fill("Cell").join(" | ") + " |\n";
        }
        tableMd += "\n";

        const view = editorRef.current;
        if (view) {
            const { from, to } = view.state.selection.main;
            view.dispatch({
                changes: { from, to, insert: tableMd },
                selection: { anchor: from + tableMd.length }
            });
            view.focus();
        }

        setIsInsertMenuOpen(false);
        showToast(`Inserted ${rows}x${cols} Table`);
    };

    const onImageFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const key = await saveImageToAssetStore(file);
            const markdown = `![Image | ${imageWidths.pasted}](${key})`;

            const view = editorRef.current;
            if (view) {
                const { from, to } = view.state.selection.main;
                view.dispatch({
                    changes: { from, to, insert: markdown },
                    selection: { anchor: from + markdown.length }
                });
                view.focus();
            }
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
                e.preventDefault(); // ADD THIS LINE to stop default paste behavior
                const blob = items[i].getAsFile();
                try {
                    const key = await saveImageToAssetStore(blob);
                    const markdown = `![Image | ${imageWidths.pasted}](${key})`;

                    const view = editorRef.current;
                    if (view) {
                        const { from, to } = view.state.selection.main;
                        view.dispatch({
                            changes: { from, to, insert: markdown },
                            selection: { anchor: from + markdown.length }
                        });
                        view.focus();
                    }
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
        const view = editorRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const fullText = view.state.doc.toString();
        const selectedText = view.state.sliceDoc(from, to);
        const textToRefine = selectedText || fullText;

        // Configuration based on active provider
        const config = {
            provider: aiProvider,
            apiKey: aiProvider === 'gemini' ? geminiKeys[activeGeminiIndex] : apiKeys[activeApiKeyIndex],
            model: aiProvider === 'gemini' ? geminiModel : 'llama-3.3-70b-versatile',
            systemInstruction: MAGIC_REFINE_PROMPT,
            prompt: `Refine this note. Return only markdown: \n\n${textToRefine}`,
            temperature: 0
        };

        setLastRefinedContent(fullText);
        setLastRefinedNoteId(activeNoteId);
        setCanUndoRefine(true);
        setIsRefining(true);

        try {
            let refinedText = await processAiRequest(config);

            // Sanitizer: Remove markdown code fences if AI added them
            if (refinedText.startsWith('```')) {
                refinedText = refinedText.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
            }

            if (selectedText) {
                view.dispatch({ changes: { from, to, insert: refinedText } });
            } else {
                view.dispatch({ changes: { from: 0, to: fullText.length, insert: refinedText } });
            }
        } catch (error) {
            alert('AI Refine failed: ' + error.message);
        } finally {
            setIsRefining(false);
        }
    };

    const handleCustomRefine = async () => {
        if (!customRefineText.trim()) {
            alert("Please enter custom instructions for refinement.");
            return;
        }

        const view = editorRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const fullText = view.state.doc.toString();
        const selectedText = view.state.sliceDoc(from, to);
        const textToRefine = selectedText || fullText;

        const config = {
            provider: aiProvider,
            apiKey: aiProvider === 'gemini' ? geminiKeys[activeGeminiIndex] : apiKeys[activeApiKeyIndex],
            model: aiProvider === 'gemini' ? geminiModel : 'llama-3.3-70b-versatile',
            systemInstruction: CUSTOM_REFINE_SYSTEM_PROMPT,
            prompt: `[USER INSTRUCTION]: "${customRefineText}"\n[CONTENT TO REFINE]:\n${textToRefine}\nRefine the content above. Return ONLY the final markdown.`,
            temperature: 0.2
        };

        setLastRefinedContent(fullText);
        setLastRefinedNoteId(activeNoteId);
        setCanUndoRefine(true);
        setIsRefining(true);
        setIsCustomRefineOpen(false);

        try {
            let refinedText = await processAiRequest(config);

            if (refinedText.startsWith('```')) {
                refinedText = refinedText.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
            }

            if (selectedText) {
                view.dispatch({ changes: { from, to, insert: refinedText } });
            } else {
                view.dispatch({ changes: { from: 0, to: fullText.length, insert: refinedText } });
            }
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
        const view = editorRef.current;
        if (!view) return;

        const { from, to } = view.state.selection.main;
        const selectedText = view.state.sliceDoc(from, to);
        const newText = prefix + selectedText + suffix;

        view.dispatch({
            changes: { from, to, insert: newText },
            // This highlights the text inside the brackets/asterisks automatically!
            selection: { anchor: from + prefix.length, head: from + prefix.length + selectedText.length }
        });

        setIsColorMenuOpen(false);
        view.focus();
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
        const view = editorRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const fullText = view.state.doc.toString();
        const selectedText = view.state.sliceDoc(from, to);

        if (!selectedText.trim().startsWith('$$') || !selectedText.trim().endsWith('$$')) {
            alert("Please select an entire math block (including $$ delimiters).");
            return;
        }

        const segmentsPrompt = await requestPrompt("Target number of segments to split this block into?", "2");
        if (segmentsPrompt === null) return;
        const segmentsNum = parseInt(segmentsPrompt, 10);

        const config = {
            provider: aiProvider,
            apiKey: aiProvider === 'gemini' ? geminiKeys[activeGeminiIndex] : apiKeys[activeApiKeyIndex],
            model: aiProvider === 'gemini' ? geminiModel : 'llama-3.3-70b-versatile',
            systemInstruction: BREAK_MATH_PROMPT,
            prompt: `Split this math block into exactly ${segmentsNum} logical separate blocks:\n\n${selectedText}`,
            temperature: 0
        };

        setIsBreakingMath(true);
        setIsToolsMenuOpen(false);
        try {
            const result = await processAiRequest(config);
            if (selectedText) {
                view.dispatch({ changes: { from, to, insert: result } });
            } else {
                view.dispatch({ changes: { from: 0, to: fullText.length, insert: result } });
            }
        } catch (error) {
            alert('Failed to break math block: ' + error.message);
        } finally {
            setIsBreakingMath(false);
        }
    };

    // --- SYNC SCROLL LOGIC ---
    const handlePreviewClick = (e) => {
        // Fix Interaction Conflict: Prevent jump if user is selecting text
        if (window.getSelection().toString().length > 0) return;

        // 1. Find the clicked element
        const target = e.target.closest('[data-source-line]');
        if (!target) return;

        // 2. Get the line number generated by the Markdown parser
        const trueLineNum = parseInt(target.getAttribute('data-source-line'), 10);
        const view = editorRef.current;

        if (isNaN(trueLineNum) || !view) return;

        try {
            // CodeMirror lines are 1-indexed. Clamp it just in case.
            const docLines = view.state.doc.lines;
            const safeLineNum = Math.max(1, Math.min(trueLineNum, docLines));

            // Get the exact Line object from CodeMirror
            const line = view.state.doc.line(safeLineNum);

            // Jump to the exact line, set the cursor, and center it on screen!
            view.dispatch({
                selection: { anchor: line.from },
                effects: [EditorView.scrollIntoView(line.from, { y: 'center' })]
            });

            view.focus();
        } catch (error) {
            console.error("Scroll sync failed", error);
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
            let restoredText = p.text;

            // YOUR FIX: Force $$ block $$ to act like a centered block!
            // This safely bypasses Markdown's list-indentation bugs.
            if (p.key.startsWith('@@BLOCK_MATH_')) {
                // Extract the inner equation by removing the $$
                const innerMath = p.text.replace(/^\$\$|\$\$$/g, '');

                // 1. Wrap in a special center span. (Span is used because Markdown safely parses inside it)
                // 2. Use a single $ so the parser sees it.
                // 3. Inject \displaystyle so KaTeX knows to render it large like a block!
                restoredText = `<span class="math-center-wrapper">$\\displaystyle ${innerMath}$</span>`;
            }

            c = c.split(p.key + p.padding).join(restoredText);
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
                        className={`btn-view ${viewMode === 'live' ? 'active' : ''}`}
                        onClick={() => setViewMode('live')} title="Live Preview">
                        <Monitor size={14} /> Live
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
                                <Plus size={18} />
                            </button>
                            <button className="sidebar-icon-btn" onClick={() => createFolder()} title="New Folder">
                                <FolderPlus size={18} />
                            </button>
                            <button className="sidebar-icon-btn" onClick={() => window.electronAPI?.openNotesFolder()} title="Open Native Notes Folder in OS">
                                <Folder size={16} />
                            </button>
                            <button className="sidebar-icon-btn" onClick={() => importInputRef.current?.click()} title="Import .zip">
                                <Upload size={16} />
                            </button>
                            <input type="file" ref={importInputRef} style={{ display: 'none' }} accept=".zip" onChange={handleImportPoring} />
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

                {/* Editor Pane (Shows in Split, Editor, OR Live mode) */}
                {(viewMode === 'split' || viewMode === 'editor' || viewMode === 'live') && (
                    <section className="editor-pane" style={(viewMode === 'editor' || viewMode === 'live') ? { borderRight: 'none' } : {}}>
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
                                <div className={`format-toolbar-container ${isToolsMenuOpen ? 'expanded' : ''}`} style={{ display: 'flex', alignItems: 'center' }}>
                                    {/* --- NEW 1-CLICK FORMATTING TOOLBAR --- */}
                                    <div className="format-toolbar">
                                        <button className="format-btn" onClick={() => handleFormatting("**", "**")} title="Bold"><Bold size={14} /></button>
                                        <button className="format-btn" onClick={() => handleFormatting("*", "*")} title="Italic"><Italic size={14} /></button>
                                        <button className="format-btn" onClick={() => handleFormatting("++", "++")} title="Underline"><Underline size={14} /></button>
                                        <button className="format-btn" onClick={() => handleFormatting("~~", "~~")} title="Strikethrough"><Strikethrough size={14} /></button>
                                        <button className="format-btn" onClick={() => handleFormatting("==", "==")} title="Highlight"><Highlighter size={14} /></button>
                                        <div className="toolbar-divider"></div>
                                        <button className="format-btn" onClick={() => handleFormatting("center[", "]")} title="Center Align"><AlignCenter size={14} /></button>

                                        <div className="toolbar-divider"></div>
                                        <button className="format-btn" onClick={handleOpenDrawMode} title="Draw / Annotate"><Pen size={14} /></button>
                                    </div>

                                    {/* --- ADVANCED TOOLS DROPDOWN --- */}
                                    <div className="tools-dropdown-container" style={{ position: 'relative' }}>
                                        <button
                                            className={`btn-insert ${isToolsMenuOpen ? 'active' : ''}`}
                                            onClick={() => setIsToolsMenuOpen(!isToolsMenuOpen)}
                                            disabled={!activeNote}
                                            title="Advanced Tools"
                                        >
                                            <Wrench size={14} />
                                            <ChevronDown size={14} className={`arrow ${isToolsMenuOpen ? 'up' : ''}`} />
                                        </button>

                                        {isToolsMenuOpen && (
                                            <div className="insert-menu tools-menu">
                                                <div className="insert-option" onClick={() => handleFormatting("", "\n***\n")}>
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
                                {/* --- MINIMALIST ICON-ONLY CLIPBOARD BUTTON --- */}
                                <button
                                    className={`btn-auto-note ${isAutoNoteEnabled ? 'active' : ''}`}
                                    onClick={toggleAutoNote}
                                    disabled={!activeNote}
                                    title={
                                        !isAutoNoteEnabled
                                            ? "Auto-Note: OFF"
                                            : isAiClipboardEnabled
                                                ? "Auto-Note: ON (AI Format Fixer Active)"
                                                : "Auto-Note: ON (Standard)"
                                    }
                                    style={{
                                        background: isAutoNoteEnabled && isAiClipboardEnabled ? '#8b5cf6' : (isAutoNoteEnabled ? '#10b981' : 'transparent'),
                                        color: isAutoNoteEnabled ? 'white' : 'var(--text-main)',
                                        border: isAutoNoteEnabled ? 'none' : '1px solid var(--border-color)',
                                        width: '34px',
                                        height: '34px',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                        boxShadow: isAutoNoteEnabled && isAiClipboardEnabled ? '0 0 10px rgba(139, 92, 246, 0.5)' : 'none',
                                        flexShrink: 0
                                    }}
                                >
                                    <ClipboardCheck size={18} />
                                </button>
                                {/* Undo button removed as requested */}
                                <button className="btn-custom-refine" onClick={() => setIsCustomRefineOpen(true)} disabled={isRefining || !activeNote} title="Custom Refine">
                                    <Wand2 size={14} />
                                </button>
                                <button className={`btn-magic ${isRefining ? 'loading' : ''}`} onClick={handleMagicRefine} disabled={isRefining || !activeNote} title="Enhance Syntax">
                                    {isRefining ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                                </button>
                            </div>
                        </div>

                        {/* THE NEW CONDITIONAL EDITOR RENDERING */}
                        {viewMode === 'live' ? (
                            <LivePreviewEditor
                                value={localContent}
                                onChange={setLocalContent}
                                onPaste={handlePaste}
                                placeholder="Start typing... (Live Mode)"
                                editorViewRef={editorRef}
                            />
                        ) : (
                            <ColorfulEditor
                                value={localContent}
                                onChange={setLocalContent}
                                onPaste={handlePaste}
                                placeholder="Start typing..."
                                editorViewRef={editorRef}
                            />
                        )}
                    </section>
                )}

                {/* CONDITIONAL PREVIEW PANE */}
                {(viewMode === 'split' || viewMode === 'preview') && (
                    <section className="preview-pane">
                        <div className="preview-header">
                            <span>PDF Preview</span>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button className="btn-export" onClick={handleExportPoring} disabled={!activeNote} title="Export as .zip file">
                                    <Download size={14} /> .zip
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

            {isSettingsOpen && (
                <div className="modal-overlay" onMouseDown={() => setIsSettingsOpen(false)}>
                    <div className="modal-content settings-modal-container" onMouseDown={e => e.stopPropagation()}>
                        
                        {/* Header */}
                        <div className="settings-header">
                            <h3>Preferences</h3>
                            <X size={20} className="close-btn" style={{ cursor: 'pointer', opacity: 0.6 }} onClick={() => setIsSettingsOpen(false)} />
                        </div>

                        {/* Body */}
                        <div className="settings-body">
                            
                            {/* Section: AI Provider */}
                            <div className="settings-group">
                                <span className="settings-label-main">AI Provider Settings</span>
                                <div className="settings-card">
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-title">Active Provider</span>
                                        </div>
                                        <select 
                                            className="elite-select" 
                                            value={aiProvider} 
                                            onChange={(e) => setAiProvider(e.target.value)}
                                            style={{ width: '180px' }}
                                        >
                                            <option value="gemini">Google Gemini</option>
                                            <option value="groq">Groq (Llama)</option>
                                        </select>
                                    </div>

                                    {aiProvider === 'gemini' ? (
                                        <>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                {geminiKeys.map((key, idx) => (
                                                    <div 
                                                        key={idx} 
                                                        className={`elite-radio-row ${activeGeminiIndex === idx ? 'active' : ''}`}
                                                        onClick={() => setActiveGeminiIndex(idx)}
                                                    >
                                                        <div className="custom-radio"><div className="custom-radio-inner" /></div>
                                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                <span className="settings-row-title" style={{ fontSize: '0.8rem' }}>Gemini API Key {idx + 1}</span>
                                                                {geminiKeys.length > 1 && (
                                                                    <Trash2 size={14} style={{cursor:'pointer', color:'#ff4d4d'}} onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const newKeys = geminiKeys.filter((_, i) => i !== idx);
                                                                        setGeminiKeys(newKeys);
                                                                        if (activeGeminiIndex >= newKeys.length) setActiveGeminiIndex(newKeys.length - 1);
                                                                    }} />
                                                                )}
                                                            </div>
                                                            <input 
                                                                type="password" 
                                                                value={key} 
                                                                onChange={(e) => {
                                                                    const newKeys = [...geminiKeys];
                                                                    newKeys[idx] = e.target.value;
                                                                    setGeminiKeys(newKeys);
                                                                }} 
                                                                onClick={(e) => e.stopPropagation()} 
                                                                placeholder="AIzaSy..." 
                                                                className="elite-input" 
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                                {geminiKeys.length < 5 && (
                                                    <div className="settings-row" style={{ justifyContent: 'center', padding: '8px', borderBottom: '1px solid var(--border-color)' }}>
                                                        <button className="btn-secondary" onClick={() => setGeminiKeys([...geminiKeys, ''])}>
                                                            <Plus size={14} /> Add Gemini Key
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                                                <span className="settings-row-title">Select Model</span>
                                                <select value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} className="elite-select">
                                                    {GEMINI_MODELS.map(m => (
                                                        <option key={m.id} value={m.id}>{m.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            {apiKeys.map((key, idx) => (
                                                <div 
                                                    key={idx} 
                                                    className={`elite-radio-row ${activeApiKeyIndex === idx ? 'active' : ''}`}
                                                    onClick={() => setActiveApiKeyIndex(idx)}
                                                >
                                                    <div className="custom-radio"><div className="custom-radio-inner" /></div>
                                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                            <span className="settings-row-title" style={{ fontSize: '0.8rem' }}>Groq API Key {idx + 1}</span>
                                                            {apiKeys.length > 1 && (
                                                                <Trash2 size={14} style={{cursor:'pointer', color:'#ff4d4d'}} onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const newKeys = apiKeys.filter((_, i) => i !== idx);
                                                                    setApiKeys(newKeys);
                                                                    if (activeApiKeyIndex >= newKeys.length) setActiveApiKeyIndex(newKeys.length - 1);
                                                                }} />
                                                            )}
                                                        </div>
                                                        <input 
                                                            type="password" 
                                                            value={key} 
                                                            onChange={(e) => {
                                                                const newKeys = [...apiKeys];
                                                                newKeys[idx] = e.target.value;
                                                                setApiKeys(newKeys);
                                                            }} 
                                                            onClick={(e) => e.stopPropagation()} 
                                                            placeholder={`gsk_key_0${idx + 1}...`} 
                                                            className="elite-input" 
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                            {apiKeys.length < 5 && (
                                                <div className="settings-row" style={{ justifyContent: 'center', padding: '8px' }}>
                                                    <button className="btn-secondary" onClick={() => setApiKeys([...apiKeys, ''])}>
                                                        <Plus size={14} /> Add Groq Key
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Section: Workflow & AI */}
                            <div className="settings-group">
                                <span className="settings-label-main">Workflow & AI</span>
                                <div className="settings-card">
                                    <div className="settings-row">
                                        <div className="settings-row-info">
                                            <span className="settings-row-title">Enable AI Format Fixer</span>
                                            <span className="settings-row-desc">Automatically cleans up formatting when you paste text.</span>
                                        </div>
                                        <div 
                                            className={`elite-toggle ${isAiClipboardEnabled ? 'active' : ''}`} 
                                            onClick={toggleAiClipboard}
                                        >
                                            <div className="elite-toggle-thumb" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Section: Editor & Media */}
                            <div className="settings-group">
                                <span className="settings-label-main">Editor & Media</span>
                                <div className="settings-card">
                                    <div className="settings-row" style={{ gap: '16px' }}>
                                        <div style={{ flex: 1 }}>
                                            <span className="settings-row-title" style={{ display: 'block', marginBottom: '8px' }}>Pasted Image Width (px)</span>
                                            <input 
                                                type="number" 
                                                value={imageWidths.pasted} 
                                                onChange={(e) => setImageWidths({ ...imageWidths, pasted: e.target.value === '' ? '' : parseInt(e.target.value) })} 
                                                onBlur={() => setImageWidths({ ...imageWidths, pasted: imageWidths.pasted || 300 })}
                                                className="elite-input" 
                                            />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <span className="settings-row-title" style={{ display: 'block', marginBottom: '8px' }}>Auto-Note Image Width (px)</span>
                                            <input 
                                                type="number" 
                                                value={imageWidths.autoNote} 
                                                onChange={(e) => setImageWidths({ ...imageWidths, autoNote: e.target.value === '' ? '' : parseInt(e.target.value) })} 
                                                onBlur={() => setImageWidths({ ...imageWidths, autoNote: imageWidths.autoNote || 450 })}
                                                className="elite-input" 
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Section: Typography */}
                            <div className="settings-group">
                                <span className="settings-label-main">Typography & Spacing</span>
                                <div className="settings-card">
                                    <div className="settings-row" style={{ gap: '16px', borderBottom: 'none', paddingBottom: '0' }}>
                                        <div style={{ flex: 1 }}>
                                            <span className="settings-row-title" style={{ display: 'block', marginBottom: '8px' }}>Font Family</span>
                                            <select value={typography.font} onChange={(e) => setTypography({ ...typography, font: e.target.value })} className="elite-select">
                                                <option value="Sans">Modern (Sans)</option>
                                                <option value="Serif">LaTeX (Standard)</option>
                                                <option value="Mono">Code (Mono)</option>
                                            </select>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <span className="settings-row-title" style={{ display: 'block', marginBottom: '8px' }}>Line Spacing</span>
                                            <select value={spacing} onChange={(e) => setSpacing(e.target.value)} className="elite-select">
                                                <option value="Too narrow">Too narrow</option>
                                                <option value="narrow">Narrow</option>
                                                <option value="normal">Normal</option>
                                                <option value="wide">Wide</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="settings-row">
                                        <div style={{ flex: 1 }}>
                                            <span className="settings-row-title" style={{ display: 'block', marginBottom: '8px' }}>Font Size (px)</span>
                                            <input 
                                                type="number" 
                                                value={typography.size} 
                                                onChange={(e) => setTypography({ ...typography, size: e.target.value === '' ? '' : parseInt(e.target.value) })} 
                                                onBlur={() => setTypography({ ...typography, size: typography.size || 13 })}
                                                className="elite-input" 
                                                style={{ width: '50%' }} 
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>

                        {/* Footer */}
                        <div className="settings-footer">
                            <div className="settings-footer-left">
                                <a 
                                    href="#"
                                    className="btn-get-api"
                                    style={{ padding: 0, background: 'transparent' }}
                                    onClick={(e) => {
                                        e.preventDefault(); 
                                        const url = aiProvider === 'gemini' 
                                            ? 'https://aistudio.google.com/app/apikey' 
                                            : 'https://console.groq.com/keys';
                                        if (window.electronAPI && window.electronAPI.openExternal) {
                                            window.electronAPI.openExternal(url);
                                        } else {
                                            window.open(url, '_blank');
                                        }
                                    }}
                                >
                                    <ExternalLink size={14} /> Get {aiProvider === 'gemini' ? 'Gemini' : 'Groq'} Key
                                </a>
                                
                                {/* Visual divider */}
                                <div style={{ width: '1px', height: '16px', background: 'var(--border-color)', margin: '0 8px' }} />
                                
                                <button 
                                    className="btn-secondary" 
                                    onClick={handleCheckUpdate} 
                                    style={{ padding: '6px 12px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-editor)' }}
                                >
                                    Check for Updates
                                </button>
                                {updateStatus && (
                                    <span style={{ fontSize: '0.8rem', color: '#888', fontWeight: '500' }}>
                                        {updateStatus}
                                    </span>
                                )}
                            </div>
                            
                            {/* Save Button explicitly gets padding added back to it */}
                            <button 
                                className="btn-primary" 
                                style={{ padding: '8px 20px', borderRadius: '8px', fontSize: '0.9rem' }} 
                                onClick={() => setIsSettingsOpen(false)}
                            >
                                Save & Close
                            </button>
                        </div>

                    </div>
                </div>
            )}

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
                                autoFocus
                                value={customRefineText}
                                onChange={(e) => setCustomRefineText(e.target.value)}
                                onKeyDown={(e) => {
                                    // Submit on Enter, allow multi-line with Shift+Enter
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleCustomRefine();
                                    }
                                }}
                                placeholder="e.g., Break this math block into 2 smaller one, Change tone to academic..."
                                className="custom-refine-textarea"
                            />
                            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '4px', textAlign: 'right' }}>
                                Press <strong>Enter</strong> to refine, <strong>Shift + Enter</strong> for new line
                            </div>
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
                        {/* Removed the word "Prompt" and used the message as the header */}
                        <h3>{promptState.message.replace(':', '')}</h3>
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

            {drawModeState.isOpen && (
                <DrawMode
                    initialImageKey={drawModeState.editKey}
                    onSave={handleSaveDrawing}
                    onClose={() => setDrawModeState({ isOpen: false, editKey: null })}
                />
            )}
        </div>
    );
}

export default App;
