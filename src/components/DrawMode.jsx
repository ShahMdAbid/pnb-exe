import React, { useRef, useState, useEffect } from 'react';
import { Pen, Square, Circle, MoveUpRight, Save, X, Undo, Trash2, ImageIcon, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import localforage from 'localforage';

export default function DrawMode({ initialImageKey, onSave, onClose }) {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    
    const [baseImage, setBaseImage] = useState(null);
    const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
    const [zoom, setZoom] = useState(1);
    
    // Tools & Properties
    const [currentTool, setCurrentTool] = useState('pen');
    const [color, setColor] = useState('#ef4444');
    const [lineWidth, setLineWidth] = useState(3);
    const [autoLabel, setAutoLabel] = useState(true);
    
    const [annotations, setAnnotations] = useState([]);
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPath, setCurrentPath] = useState([]);
    const [startPoint, setStartPoint] = useState(null);
    const [currentMouse, setCurrentMouse] = useState(null);

    // Load initial image if editing
    useEffect(() => {
        if (initialImageKey) {
            localforage.getItem(initialImageKey).then(blob => {
                if (blob) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const img = new Image();
                        img.onload = () => {
                            setBaseImage(img);
                            setCanvasSize({ w: img.width, h: img.height });
                        };
                        img.src = event.target.result;
                    };
                    reader.readAsDataURL(blob);
                }
            });
        }
    }, [initialImageKey]);

    // Handle Image Paste (Ctrl+V)
    useEffect(() => {
        const handlePaste = (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const blob = items[i].getAsFile();
                    if (!blob) continue;
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const img = new Image();
                        img.onload = () => {
                            setBaseImage(img);
                            setCanvasSize({ w: img.width, h: img.height });
                            setZoom(1); // Reset zoom on new image
                        };
                        img.src = event.target.result;
                    };
                    reader.readAsDataURL(blob);
                    e.preventDefault();
                    break;
                }
            }
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, []);

    const getNextLabel = () => {
        let maxLabel = 0;
        annotations.forEach(a => {
            if (a.label !== undefined && typeof a.label === 'number') {
                maxLabel = Math.max(maxLabel, a.label);
            }
        });
        return maxLabel + 1;
    };

    const getCanvasCoords = (e) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        
        let clientX, clientY;
        if ('touches' in e) {
            if (e.touches.length === 0) return null;
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        
        // This math perfectly maps mouse position to the canvas, regardless of zoom level
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const handlePointerDown = (e) => {
        const coords = getCanvasCoords(e);
        if (!coords) return;
        setIsDrawing(true);
        setStartPoint(coords);
        if (currentTool === 'pen') setCurrentPath([coords]);
        else setCurrentMouse(coords);
    };

    const handlePointerMove = (e) => {
        if (!isDrawing) return;
        const coords = getCanvasCoords(e);
        if (!coords) return;
        if (currentTool === 'pen') setCurrentPath(prev => [...prev, coords]);
        else setCurrentMouse(coords);
    };

    const handlePointerUp = () => {
        if (isDrawing && startPoint) {
            if (currentTool === 'pen' && currentPath.length > 1) {
                setAnnotations(prev => [...prev, { type: 'pen', points: [...currentPath], color, width: lineWidth }]);
            } else if (currentMouse && ['rect', 'circle', 'arrow'].includes(currentTool)) {
                const width = currentMouse.x - startPoint.x;
                const height = currentMouse.y - startPoint.y;
                
                if (Math.abs(width) > 5 || Math.abs(height) > 5) {
                    const label = autoLabel ? getNextLabel() : undefined;
                    let newAnn = null;
                    
                    if (currentTool === 'rect') {
                        newAnn = { type: 'rect', x: startPoint.x, y: startPoint.y, w: width, h: height, color, width: lineWidth, label };
                    } else if (currentTool === 'circle') {
                        const r = Math.sqrt(width * width + height * height) / 2;
                        const cx = startPoint.x + width / 2;
                        const cy = startPoint.y + height / 2;
                        newAnn = { type: 'circle', cx, cy, r, color, width: lineWidth, label };
                    } else if (currentTool === 'arrow') {
                        newAnn = { type: 'arrow', x1: startPoint.x, y1: startPoint.y, x2: currentMouse.x, y2: currentMouse.y, color, width: lineWidth, label };
                    }
                    
                    if (newAnn) setAnnotations(prev => [...prev, newAnn]);
                }
            }
        }
        setIsDrawing(false);
        setCurrentPath([]);
        setStartPoint(null);
        setCurrentMouse(null);
    };

    // Render loop
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (baseImage) {
            ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
        } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        const drawLabelText = (text, x, y, bgColor) => {
            const padding = 2;
            const fontSize = Math.max(12, canvas.width * 0.015);
            ctx.font = `bold ${fontSize}px sans-serif`;
            const metrics = ctx.measureText(text);
            const bgWidth = metrics.width + padding * 2;
            const bgHeight = fontSize + padding * 2;
            
            ctx.fillStyle = bgColor;
            ctx.fillRect(x, y, bgWidth, bgHeight);
            
            ctx.fillStyle = '#ffffff';
            ctx.textBaseline = 'top';
            ctx.fillText(text, x + padding, y + padding);
        };

        const drawShape = (a) => {
            ctx.strokeStyle = a.color;
            ctx.lineWidth = a.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            if (a.type === 'pen' && a.points && a.points.length > 0) {
                ctx.beginPath();
                ctx.moveTo(a.points[0].x, a.points[0].y);
                for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i].x, a.points[i].y);
                ctx.stroke();
            } else if (a.type === 'rect') {
                ctx.beginPath();
                ctx.rect(a.x, a.y, a.w, a.h);
                ctx.stroke();
                if (a.label !== undefined) {
                    const left = Math.min(a.x, a.x + a.w);
                    const top = Math.min(a.y, a.y + a.h);
                    drawLabelText(a.label.toString(), left, top, a.color);
                }
            } else if (a.type === 'circle') {
                ctx.beginPath();
                ctx.arc(a.cx, a.cy, a.r, 0, 2 * Math.PI);
                ctx.stroke();
                if (a.label !== undefined) {
                    const offset = a.r * 0.7071;
                    drawLabelText(a.label.toString(), a.cx - offset, a.cy - offset, a.color);
                }
            } else if (a.type === 'arrow') {
                const headlen = a.width * 4;
                const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
                ctx.beginPath();
                ctx.moveTo(a.x1, a.y1);
                ctx.lineTo(a.x2, a.y2);
                ctx.lineTo(a.x2 - headlen * Math.cos(angle - Math.PI / 6), a.y2 - headlen * Math.sin(angle - Math.PI / 6));
                ctx.moveTo(a.x2, a.y2);
                ctx.lineTo(a.x2 - headlen * Math.cos(angle + Math.PI / 6), a.y2 - headlen * Math.sin(angle + Math.PI / 6));
                ctx.stroke();
                if (a.label !== undefined) {
                    drawLabelText(a.label.toString(), a.x2, a.y2, a.color);
                }
            }
        };

        annotations.forEach(drawShape);

        // Draw active draft
        if (isDrawing && startPoint) {
            if (currentTool === 'pen') {
                drawShape({ type: 'pen', points: currentPath, color, width: lineWidth });
            } else if (currentMouse) {
                const w = currentMouse.x - startPoint.x;
                const h = currentMouse.y - startPoint.y;
                const tempLabel = autoLabel ? getNextLabel() : undefined;
                
                if (currentTool === 'rect') drawShape({ type: 'rect', x: startPoint.x, y: startPoint.y, w, h, color, width: lineWidth, label: tempLabel });
                else if (currentTool === 'circle') drawShape({ type: 'circle', cx: startPoint.x + w/2, cy: startPoint.y + h/2, r: Math.sqrt(w*w + h*h)/2, color, width: lineWidth, label: tempLabel });
                else if (currentTool === 'arrow') drawShape({ type: 'arrow', x1: startPoint.x, y1: startPoint.y, x2: currentMouse.x, y2: currentMouse.y, color, width: lineWidth, label: tempLabel });
            }
        }
    }, [baseImage, annotations, isDrawing, currentPath, startPoint, currentMouse, currentTool, color, lineWidth, canvasSize, autoLabel]);

    const handleSave = () => {
        const canvas = canvasRef.current;
        canvas.toBlob(async (blob) => {
            const newKey = `poring_img_${Date.now()}`;
            await localforage.setItem(newKey, blob);
            onSave(newKey, initialImageKey);
        }, 'image/png');
    };

    return (
        <div className="draw-overlay">
            {/* Sidebar */}
            <div className="draw-sidebar">
                <div className="draw-sidebar-header">
                    <h2>Draw Mode</h2>
                    <p>Annotate your image</p>
                </div>
                
                <div className="draw-sidebar-content">
                    <h3 className="draw-section-title">Tools</h3>
                    <div className="draw-tools-grid">
                        <button className={`draw-tool-card ${currentTool === 'pen' ? 'active' : ''}`} onClick={() => setCurrentTool('pen')}>
                            <Pen size={20} /><span>Pen</span>
                        </button>
                        <button className={`draw-tool-card ${currentTool === 'rect' ? 'active' : ''}`} onClick={() => setCurrentTool('rect')}>
                            <Square size={20} /><span>Box</span>
                        </button>
                        <button className={`draw-tool-card ${currentTool === 'circle' ? 'active' : ''}`} onClick={() => setCurrentTool('circle')}>
                            <Circle size={20} /><span>Circle</span>
                        </button>
                        <button className={`draw-tool-card ${currentTool === 'arrow' ? 'active' : ''}`} onClick={() => setCurrentTool('arrow')}>
                            <MoveUpRight size={20} /><span>Arrow</span>
                        </button>
                    </div>

                    <h3 className="draw-section-title">View / Zoom</h3>
                    <div className="draw-tools-grid">
                        <button className="draw-tool-card" onClick={() => setZoom(z => Math.max(0.2, z - 0.2))}>
                            <ZoomOut size={16} /><span>Zoom Out</span>
                        </button>
                        <button className="draw-tool-card" onClick={() => setZoom(1)}>
                            <Maximize size={16} /><span>Reset</span>
                        </button>
                        <button className="draw-tool-card" style={{ gridColumn: 'span 2' }} onClick={() => setZoom(z => Math.min(5, z + 0.2))}>
                            <ZoomIn size={16} /><span>Zoom In</span>
                        </button>
                    </div>

                    <h3 className="draw-section-title">Properties</h3>
                    <div className="draw-property-row">
                        <span>Auto-Label</span>
                        <label className={`draw-switch ${autoLabel ? 'on' : ''}`}>
                            <input type="checkbox" checked={autoLabel} onChange={(e) => setAutoLabel(e.target.checked)} style={{ display: 'none' }} />
                            <div className="draw-switch-thumb" />
                        </label>
                    </div>

                    <div className="draw-property-row color-row">
                        <span style={{width: '100%', display: 'block', marginBottom: '8px'}}>Color</span>
                        <div className="draw-colors">
                            {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#000000', '#ffffff'].map(c => (
                                <button key={c} className={`draw-color-swatch ${color === c ? 'active' : ''}`} style={{ backgroundColor: c }} onClick={() => setColor(c)} />
                            ))}
                        </div>
                    </div>

                    <div className="draw-property-row" style={{ flexDirection: 'column', alignItems: 'flex-start', borderBottom: 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '8px' }}>
                            <span>Line Width</span>
                            <span className="draw-line-val">{lineWidth}px</span>
                        </div>
                        <input type="range" min="1" max="20" value={lineWidth} onChange={(e) => setLineWidth(Number(e.target.value))} className="draw-slider" />
                    </div>

                    <h3 className="draw-section-title">Actions</h3>
                    <div className="draw-actions-row">
                        <button className="draw-action-btn" onClick={() => setAnnotations(prev => prev.slice(0, -1))} disabled={annotations.length===0}><Undo size={16} /> Undo</button>
                        <button className="draw-action-btn danger" onClick={() => setAnnotations([])} disabled={annotations.length===0}><Trash2 size={16} /> Clear</button>
                    </div>
                </div>

                <div className="draw-sidebar-footer">
                    <button className="draw-btn-cancel" onClick={onClose}>Cancel</button>
                    <button className="draw-btn-save" onClick={handleSave}><Save size={16} /> Save</button>
                </div>
            </div>

            {/* Canvas Area */}
            <div className="draw-canvas-container" ref={containerRef}>
                {!baseImage && annotations.length === 0 && (
                    <div className="draw-empty-state">
                        <div className="draw-empty-card">
                            <ImageIcon size={40} color="#9ca3af" />
                            <h4>Start Annotating</h4>
                            <p>Paste an image (Ctrl+V) to begin</p>
                        </div>
                    </div>
                )}
                
                {/* 
                    This wrapper receives the scaled dimensions. 
                    The canvas element inside stretches to 100% of this wrapper.
                */}
                <div className="draw-canvas-wrapper" style={{ width: canvasSize.w * zoom, height: canvasSize.h * zoom }}>
                    <canvas
                        ref={canvasRef}
                        width={canvasSize.w}       // True resolution width
                        height={canvasSize.h}      // True resolution height
                        className="draw-canvas"
                        style={{ cursor: 'crosshair', width: '100%', height: '100%' }} // Stretches to wrapper via CSS
                        onMouseDown={handlePointerDown}
                        onMouseMove={handlePointerMove}
                        onMouseUp={handlePointerUp}
                        onMouseLeave={handlePointerUp}
                        onTouchStart={handlePointerDown}
                        onTouchMove={handlePointerMove}
                        onTouchEnd={handlePointerUp}
                        onTouchCancel={handlePointerUp}
                    />
                </div>
            </div>
        </div>
    );
}
