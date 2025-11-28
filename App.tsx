import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Trophy, 
  Upload, 
  Shuffle, 
  Settings, 
  Trash2, 
  CheckCircle, 
  Grid3X3, 
  Clock,
  Plus,
  Minus,
  Move,
  MousePointer2,
  Palette,
  Image as ImageIcon,
  ZoomIn,
  RefreshCcw
} from 'lucide-react';

// --- Types ---

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface InteractionState {
  mode: 'idle' | 'create' | 'resize' | 'pending_move' | 'move' | 'pan';
  startX: number;
  startY: number;
  startViewX?: number;
  startViewY?: number;
  startRect?: Rect; 
  handle?: string; 
}

interface StitchedImage {
  id: string;
  element: HTMLImageElement;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

// --- Constants ---

const HANDLE_SIZE = 10; 
const TOUCH_HIT_RADIUS = 24; 
const MIN_SELECTION = 20;
const DRAG_THRESHOLD = 5; 
const DEFAULT_ANIMATION_DURATION = 3;

// WeChat Colors
const THEME = {
  primary: 'bg-[#07C160]',
  primaryHover: 'hover:bg-[#06AD56]',
  textPrimary: 'text-[#07C160]',
  bgApp: 'bg-[#F2F2F2]',
  bgPanel: 'bg-white',
  border: 'border-gray-200',
  textMain: 'text-[#111111]',
  textSub: 'text-[#666666]'
};

// --- Helper Functions ---

const shuffleArray = <T,>(array: T[]): T[] => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// --- Main Component ---

export default function App() {
  // --- State ---
  
  // Images & Canvas
  const [images, setImages] = useState<StitchedImage[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Viewport (Zoom/Pan)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [tool, setTool] = useState<'select' | 'pan'>('select');

  // Selection & Grid
  const [selection, setSelection] = useState<Rect | null>(null);
  const [gridRows, setGridRows] = useState(1);
  const [gridCols, setGridCols] = useState(5);
  const [gridColor, setGridColor] = useState('#ffffff');
  
  // Logic
  const [excludedCells, setExcludedCells] = useState<Set<number>>(new Set());
  const [winnerCount, setWinnerCount] = useState(1);
  const [winners, setWinners] = useState<number[]>([]);
  const [animationDuration, setAnimationDuration] = useState(DEFAULT_ANIMATION_DURATION);
  const [isAnimating, setIsAnimating] = useState(false);
  const [tempHighlighted, setTempHighlighted] = useState<number[]>([]); 

  // Interaction
  const interactionRef = useRef<InteractionState>({ 
    mode: 'idle', 
    startX: 0, 
    startY: 0 
  });
  
  // Derived
  const totalCells = gridRows * gridCols;
  const validCellsCount = totalCells - excludedCells.size;

  // --- Effects ---

  // Redraw
  useEffect(() => {
    drawCanvas();
  }, [images, selection, gridRows, gridCols, excludedCells, winners, tempHighlighted, isAnimating, gridColor]);

  // Clean up object URLs
  useEffect(() => {
    return () => {
      images.forEach(img => {
        if (img.element.src.startsWith('blob:')) {
          URL.revokeObjectURL(img.element.src);
        }
      });
    };
  }, [images]);

  // --- Core Graphics Logic ---

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || images.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Calculate Stitched Dimensions
    // We scale all images to the width of the widest image to create a seamless column
    const maxWidth = Math.max(...images.map(i => i.originalWidth));
    let totalHeight = 0;
    const drawMeta = images.map(img => {
      const scaleFactor = maxWidth / img.originalWidth;
      const renderHeight = img.originalHeight * scaleFactor;
      const y = totalHeight;
      totalHeight += renderHeight;
      return { img: img.element, h: renderHeight, y };
    });

    // 2. Resize Canvas
    if (canvas.width !== maxWidth || canvas.height !== totalHeight) {
      canvas.width = maxWidth;
      canvas.height = totalHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 3. Draw Images Stacked
    drawMeta.forEach(({ img, h, y }) => {
      ctx.drawImage(img, 0, y, maxWidth, h);
    });

    // If no selection, we stop here
    if (!selection) return;

    // 4. Draw Mask
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(selection.x, selection.y, selection.w, selection.h); 
    ctx.fill('evenodd');

    // 5. Draw Grid
    const cellW = selection.w / gridCols;
    const cellH = selection.h / gridRows;

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = Math.max(1, 1 / view.scale); // Keep lines consistent visual width
    ctx.beginPath();

    // Vertical lines
    for (let c = 1; c < gridCols; c++) {
      const x = selection.x + c * cellW;
      ctx.moveTo(x, selection.y);
      ctx.lineTo(x, selection.y + selection.h);
    }
    // Horizontal lines
    for (let r = 1; r < gridRows; r++) {
      const y = selection.y + r * cellH;
      ctx.moveTo(selection.x, y);
      ctx.lineTo(selection.x + selection.w, y);
    }
    ctx.stroke();

    // 6. Draw Cells
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const index = r * gridCols + c;
        const x = selection.x + c * cellW;
        const y = selection.y + r * cellH;

        // Draw Excluded
        if (excludedCells.has(index)) {
          ctx.fillStyle = 'rgba(50, 50, 50, 0.7)';
          ctx.fillRect(x, y, cellW, cellH);
          
          // Draw X
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 5, y + 5);
          ctx.lineTo(x + cellW - 5, y + cellH - 5);
          ctx.moveTo(x + cellW - 5, y + 5);
          ctx.lineTo(x + 5, y + cellH - 5);
          ctx.stroke();
        }

        // Draw Winners
        if (winners.includes(index)) {
          ctx.lineWidth = 6;
          ctx.strokeStyle = '#ef4444'; 
          ctx.strokeRect(x + 3, y + 3, cellW - 6, cellH - 6);
          
          const rank = winners.indexOf(index) + 1;
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(x, y, 32, 32);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 20px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(rank.toString(), x + 16, y + 16);
        }

        // Draw Animation Flash
        if (isAnimating && tempHighlighted.includes(index)) {
           ctx.lineWidth = 6;
           ctx.strokeStyle = '#FBBF24'; // Amber
           ctx.strokeRect(x + 3, y + 3, cellW - 6, cellH - 6);
        }
      }
    }

    // 7. Draw Selection Border
    ctx.strokeStyle = '#07C160'; // WeChat Green
    ctx.lineWidth = 3;
    ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);

    // 8. Draw Handles
    if (!isAnimating && tool === 'select') {
      drawHandles(ctx, selection);
    }

  }, [images, selection, gridCols, gridRows, excludedCells, winners, isAnimating, tempHighlighted, gridColor, view.scale, tool]);

  const drawHandles = (ctx: CanvasRenderingContext2D, rect: Rect) => {
    const { x, y, w, h } = rect;
    // Scale handle size inversely to zoom so they remain constant visual size
    const size = HANDLE_SIZE / view.scale; 
    
    const points = [
      { x, y }, { x: x + w / 2, y }, { x: x + w, y },
      { x, y: y + h / 2 }, { x: x + w, y: y + h / 2 },
      { x, y: y + h }, { x: x + w / 2, y: y + h }, { x: x + w, y: y + h }
    ];

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#07C160';
    ctx.lineWidth = 2;

    points.forEach(p => {
      ctx.beginPath();
      ctx.rect(p.x - size / 2, p.y - size / 2, size, size);
      ctx.fill();
      ctx.stroke();
    });
  };

  // --- Input Handling ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const newImages: StitchedImage[] = [];
      let loadedCount = 0;

      Array.from(files).forEach((file) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.src = url;
        img.onload = () => {
          newImages.push({
            id: Math.random().toString(36).substr(2, 9),
            element: img,
            width: img.naturalWidth,
            height: img.naturalHeight,
            originalWidth: img.naturalWidth,
            originalHeight: img.naturalHeight
          });
          loadedCount++;
          
          if (loadedCount === files.length) {
            // Sort by filename if possible? Browsers don't always give order. 
            // We just append.
            setImages(prev => [...prev, ...newImages]);
            if (!selection) {
                // Reset if first upload
                setExcludedCells(new Set());
                setWinners([]);
            }
          }
        };
      });
    }
  };

  // --- Geometry Helpers ---

  const getClientPos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, screenX: 0, screenY: 0 };
    
    // getBoundingClientRect returns the TRANSFORMED dimensions (screen space)
    const rect = canvas.getBoundingClientRect();
    
    // Calculate scaling factor between Rendered Pixels (Canvas internal) and Screen Pixels
    // canvas.width is internal resolution. rect.width is screen size.
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      screenX: e.clientX,
      screenY: e.clientY
    };
  };

  const getHandle = (x: number, y: number, rect: Rect): string | undefined => {
    // Adjust hit radius by view scale so it's easy to hit when zoomed out
    const scale = (canvasRef.current?.width || 1000) / (canvasRef.current?.getBoundingClientRect().width || 1000);
    const HIT = TOUCH_HIT_RADIUS * scale;

    const { x: rx, y: ry, w, h } = rect;
    
    if (Math.abs(x - rx) < HIT && Math.abs(y - ry) < HIT) return 'nw';
    if (Math.abs(x - (rx + w)) < HIT && Math.abs(y - ry) < HIT) return 'ne';
    if (Math.abs(x - rx) < HIT && Math.abs(y - (ry + h)) < HIT) return 'sw';
    if (Math.abs(x - (rx + w)) < HIT && Math.abs(y - (ry + h)) < HIT) return 'se';
    
    if (Math.abs(x - (rx + w/2)) < HIT && Math.abs(y - ry) < HIT) return 'n';
    if (Math.abs(x - (rx + w/2)) < HIT && Math.abs(y - (ry + h)) < HIT) return 's';
    if (Math.abs(x - rx) < HIT && Math.abs(y - (ry + h/2)) < HIT) return 'w';
    if (Math.abs(x - (rx + w)) < HIT && Math.abs(y - (ry + h/2)) < HIT) return 'e';

    return undefined;
  };

  const isInside = (x: number, y: number, rect: Rect) => {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  };

  // --- Pointer Events ---

  const handlePointerDown = (e: React.PointerEvent) => {
    if (images.length === 0 || isAnimating) return;
    const pos = getClientPos(e);
    
    // 0. Pan Tool Mode
    if (tool === 'pan') {
      interactionRef.current = {
        mode: 'pan',
        startX: e.clientX, // Screen coords for panning
        startY: e.clientY,
        startViewX: view.x,
        startViewY: view.y
      };
      return;
    }

    // 1. Check Handles (Resize)
    if (selection) {
      const handle = getHandle(pos.x, pos.y, selection);
      if (handle) {
        interactionRef.current = {
          mode: 'resize',
          startX: pos.x,
          startY: pos.y,
          startRect: { ...selection },
          handle
        };
        return;
      }
      
      // 2. Check Inside Selection (Move OR Click-to-Mark)
      if (isInside(pos.x, pos.y, selection)) {
        interactionRef.current = {
          mode: 'pending_move',
          startX: pos.screenX,
          startY: pos.screenY,
          startRect: { ...selection }
        };
        return;
      }
    }

    // 3. Create New Selection
    setSelection(null);
    setExcludedCells(new Set());
    setWinners([]);
    interactionRef.current = {
      mode: 'create',
      startX: pos.x,
      startY: pos.y
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (images.length === 0 || isAnimating) return;
    const pos = getClientPos(e);
    const state = interactionRef.current;

    // Pan Logic
    if (state.mode === 'pan') {
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      setView(v => ({
        ...v,
        x: (state.startViewX || 0) + dx,
        y: (state.startViewY || 0) + dy
      }));
      return;
    }

    const normalize = (r: Rect) => {
      let { x, y, w, h } = r;
      if (w < 0) { x += w; w = Math.abs(w); }
      if (h < 0) { y += h; h = Math.abs(h); }
      return { x, y, w, h };
    };

    if (state.mode === 'create') {
      const w = pos.x - state.startX;
      const h = pos.y - state.startY;
      setSelection(normalize({ x: state.startX, y: state.startY, w, h }));
    } 
    else if (state.mode === 'pending_move') {
       const dist = Math.sqrt(Math.pow(pos.screenX - state.startX, 2) + Math.pow(pos.screenY - state.startY, 2));
       if (dist > DRAG_THRESHOLD && state.startRect) {
         interactionRef.current.mode = 'move';
         interactionRef.current.startX = pos.x; 
         interactionRef.current.startY = pos.y;
         setExcludedCells(new Set());
         setWinners([]);
       }
    }
    else if (state.mode === 'move' && state.startRect) {
      const dx = pos.x - state.startX;
      const dy = pos.y - state.startY;
      
      let newX = state.startRect.x + dx;
      let newY = state.startRect.y + dy;
      
      // Basic bounds check (using canvas size which is total image size)
      const canvas = canvasRef.current;
      if (canvas) {
        newX = Math.max(0, Math.min(newX, canvas.width - state.startRect.w));
        newY = Math.max(0, Math.min(newY, canvas.height - state.startRect.h));
      }

      setSelection({ ...state.startRect, x: newX, y: newY });
    }
    else if (state.mode === 'resize' && state.startRect && state.handle) {
      setExcludedCells(new Set());
      setWinners([]);

      const dx = pos.x - state.startX;
      const dy = pos.y - state.startY;
      const r = { ...state.startRect };

      if (state.handle.includes('e')) r.w += dx;
      if (state.handle.includes('s')) r.h += dy;
      if (state.handle.includes('w')) { r.x += dx; r.w -= dx; }
      if (state.handle.includes('n')) { r.y += dy; r.h -= dy; }

      if (r.w < MIN_SELECTION) r.w = MIN_SELECTION;
      if (r.h < MIN_SELECTION) r.h = MIN_SELECTION;
      
      setSelection(normalize(r));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (images.length === 0 || isAnimating) return;
    const state = interactionRef.current;
    
    if (state.mode === 'pending_move' && selection) {
        const pos = getClientPos(e);
        toggleCellExclusion(pos.x, pos.y);
    }

    interactionRef.current = { mode: 'idle', startX: 0, startY: 0 };
    
    if (selection && (selection.w < MIN_SELECTION || selection.h < MIN_SELECTION)) {
      setSelection(null);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
     // Zoom on wheel
     const zoomSpeed = 0.001;
     const newScale = Math.max(0.1, Math.min(5, view.scale - e.deltaY * zoomSpeed));
     setView(v => ({ ...v, scale: newScale }));
  };

  // --- Logic Functions ---

  const toggleCellExclusion = (x: number, y: number) => {
    if (!selection) return;

    const relX = x - selection.x;
    const relY = y - selection.y;

    const cellW = selection.w / gridCols;
    const cellH = selection.h / gridRows;

    const col = Math.floor(relX / cellW);
    const row = Math.floor(relY / cellH);

    if (col >= 0 && col < gridCols && row >= 0 && row < gridRows) {
      const index = row * gridCols + col;
      const newExcluded = new Set(excludedCells);
      if (newExcluded.has(index)) {
        newExcluded.delete(index);
      } else {
        newExcluded.add(index);
      }
      setExcludedCells(newExcluded);
      if (winners.includes(index)) {
        setWinners([]);
      }
    }
  };

  const startLottery = () => {
    if (isAnimating || validCellsCount <= 0) return;
    if (winnerCount > validCellsCount) {
      alert(`Cannot pick ${winnerCount} winners from ${validCellsCount} valid cells.`);
      return;
    }

    setIsAnimating(true);
    setWinners([]);
    setTempHighlighted([]);

    const pool = [];
    for (let i = 0; i < totalCells; i++) {
      if (!excludedCells.has(i)) pool.push(i);
    }

    const durationMs = animationDuration * 1000;
    const startTime = Date.now();
    const interval = 80; 
    let lastUpdate = 0;

    const animate = () => {
      const now = Date.now();
      const elapsed = now - startTime;

      if (elapsed < durationMs) {
        if (now - lastUpdate > interval) {
          const randomSelection = shuffleArray(pool).slice(0, winnerCount);
          setTempHighlighted(randomSelection);
          lastUpdate = now;
        }
        requestAnimationFrame(animate);
      } else {
        const finalWinners = shuffleArray(pool).slice(0, winnerCount);
        setWinners(finalWinners);
        setTempHighlighted([]);
        setIsAnimating(false);
      }
    };

    requestAnimationFrame(animate);
  };

  const zoomStep = (delta: number) => {
    setView(v => ({ ...v, scale: Math.max(0.1, Math.min(5, v.scale + delta)) }));
  };

  const resetView = () => {
    setView({ scale: 1, x: 0, y: 0 });
  };

  // --- Render ---

  return (
    <div className={`min-h-screen flex flex-col font-sans ${THEME.bgApp} ${THEME.textMain}`}>
      {/* Header */}
      <header className={`bg-[#EDEDED] border-b ${THEME.border} h-16 flex items-center px-4 md:px-6 fixed w-full z-50`}>
        <div className="flex items-center gap-3">
          <div className="bg-[#07C160] text-white p-1.5 rounded-lg">
            <Trophy className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-medium tracking-wide">Moments Lottery</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
           <label className={`${THEME.primary} hover:opacity-90 text-white px-4 py-2 rounded-md text-sm cursor-pointer transition flex items-center gap-2`}>
             <Plus className="w-4 h-4" />
             Add Images
             <input type="file" accept="image/*" multiple onChange={handleFileUpload} className="hidden" />
           </label>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:flex-row h-screen pt-16 overflow-hidden">
        
        {/* Left: Canvas Area */}
        <div 
          className="relative flex-1 bg-[#1e1e1e] overflow-hidden flex items-center justify-center touch-none"
          onWheel={handleWheel}
        >
          {images.length === 0 ? (
            <div className="text-center p-12 border border-dashed border-gray-600 rounded-xl bg-[#2b2b2b]">
              <ImageIcon className="w-16 h-16 text-gray-500 mx-auto mb-4" />
              <h3 className="text-gray-300 text-lg font-medium mb-2">No Images Loaded</h3>
              <p className="text-gray-500 mb-6 text-sm">Upload one or multiple screenshots to start</p>
              <label className={`${THEME.primary} hover:opacity-90 text-white px-6 py-2.5 rounded-lg cursor-pointer transition inline-flex items-center gap-2`}>
                <Upload className="w-4 h-4" />
                Select Images
                <input type="file" accept="image/*" multiple onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          ) : (
            <>
              {/* Floating Toolbar */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 backdrop-blur shadow-lg rounded-full p-1.5 z-30 border border-gray-200">
                 <button 
                   onClick={() => setTool('select')}
                   className={`p-2 rounded-full transition ${tool === 'select' ? `${THEME.primary} text-white` : 'text-gray-600 hover:bg-gray-100'}`}
                   title="Select Mode"
                 >
                   <MousePointer2 className="w-5 h-5" />
                 </button>
                 <button 
                   onClick={() => setTool('pan')}
                   className={`p-2 rounded-full transition ${tool === 'pan' ? `${THEME.primary} text-white` : 'text-gray-600 hover:bg-gray-100'}`}
                   title="Pan Mode"
                 >
                   <Move className="w-5 h-5" />
                 </button>
                 <div className="w-px h-6 bg-gray-300 mx-1"></div>
                 <button onClick={() => zoomStep(-0.2)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full">
                    <Minus className="w-4 h-4" />
                 </button>
                 <span className="text-xs font-mono min-w-[3rem] text-center">{Math.round(view.scale * 100)}%</span>
                 <button onClick={() => zoomStep(0.2)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full">
                    <Plus className="w-4 h-4" />
                 </button>
                 <button onClick={resetView} className="p-2 text-gray-600 hover:bg-gray-100 rounded-full" title="Reset View">
                    <RefreshCcw className="w-4 h-4" />
                 </button>
              </div>

              {/* Viewport Container */}
              <div 
                ref={containerRef} 
                className={`w-full h-full overflow-hidden cursor-${tool === 'pan' ? 'grab' : 'default'}`}
              >
                <canvas
                  ref={canvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  className="shadow-2xl origin-top-left transition-transform duration-75 ease-out select-none"
                  style={{ 
                    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Right: Controls Panel */}
        <aside className={`w-full md:w-80 ${THEME.bgPanel} border-l ${THEME.border} flex flex-col shadow-xl z-20`}>
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            
            {/* 1. Grid Config */}
            <section className="space-y-4">
              <div className={`flex items-center gap-2 ${THEME.textPrimary} font-medium text-sm border-b border-gray-100 pb-2`}>
                <Grid3X3 className="w-4 h-4" />
                <h2>GRID CONFIG</h2>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase">Rows</label>
                  <input 
                    type="number" 
                    min="1" 
                    value={gridRows}
                    onChange={(e) => {
                       setGridRows(Number(e.target.value));
                       setExcludedCells(new Set());
                       setWinners([]);
                    }}
                    className="w-full mt-1 bg-gray-50 border border-gray-200 rounded p-2 text-sm focus:border-[#07C160] outline-none transition"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase">Cols</label>
                  <input 
                    type="number" 
                    min="1" 
                    value={gridCols}
                    onChange={(e) => {
                       setGridCols(Number(e.target.value));
                       setExcludedCells(new Set());
                       setWinners([]);
                    }}
                    className="w-full mt-1 bg-gray-50 border border-gray-200 rounded p-2 text-sm focus:border-[#07C160] outline-none transition"
                  />
                </div>
              </div>

              <div className="space-y-1">
                 <label className="text-xs font-medium text-gray-500 uppercase flex items-center gap-2">
                   <Palette className="w-3 h-3" /> Grid Color
                 </label>
                 <div className="flex items-center gap-2 mt-1">
                    <input 
                      type="color" 
                      value={gridColor} 
                      onChange={(e) => setGridColor(e.target.value)}
                      className="w-8 h-8 rounded border-none cursor-pointer"
                    />
                    <span className="text-xs text-gray-400 uppercase">{gridColor}</span>
                 </div>
              </div>

              <div className="bg-gray-50 rounded p-3 flex justify-between items-center text-sm border border-gray-100">
                <span className="text-gray-500">Total Valid Items</span>
                <span className="font-bold text-gray-800">{validCellsCount}</span>
              </div>
            </section>

            {/* 2. Lottery Config */}
            <section className="space-y-4">
              <div className={`flex items-center gap-2 ${THEME.textPrimary} font-medium text-sm border-b border-gray-100 pb-2`}>
                <Settings className="w-4 h-4" />
                <h2>LOTTERY</h2>
              </div>

              <div>
                <label className="flex justify-between text-sm font-medium text-gray-700 mb-2">
                  <span>Winners Count</span>
                  <span className={`${THEME.textPrimary} font-bold`}>{winnerCount}</span>
                </label>
                <input 
                  type="range"
                  min="1"
                  max={Math.max(1, validCellsCount)}
                  value={winnerCount}
                  onChange={(e) => setWinnerCount(Number(e.target.value))}
                  className="w-full accent-[#07C160] h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div>
                <label className="flex justify-between text-sm font-medium text-gray-700 mb-2">
                   <div className="flex items-center gap-1">
                     <Clock className="w-3 h-3" />
                     <span>Duration</span>
                   </div>
                  <span className="text-gray-400">{animationDuration}s</span>
                </label>
                <input 
                  type="range"
                  min="1"
                  max="10"
                  step="0.5"
                  value={animationDuration}
                  onChange={(e) => setAnimationDuration(Number(e.target.value))}
                  className="w-full accent-[#07C160] h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </section>

            {/* 3. Action */}
            <div className="pt-2">
              <button
                onClick={startLottery}
                disabled={!selection || validCellsCount === 0 || isAnimating}
                className={`
                  w-full py-3.5 rounded-lg font-medium text-base shadow-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]
                  ${!selection || validCellsCount === 0 
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                    : isAnimating
                      ? 'bg-[#FBBF24] text-white cursor-wait'
                      : `${THEME.primary} ${THEME.primaryHover} text-white`
                  }
                `}
              >
                {isAnimating ? 'Running...' : 'Start Lottery'}
              </button>
            </div>
            
            {/* 4. Results */}
            {winners.length > 0 && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className={`flex items-center gap-2 ${THEME.textPrimary} font-medium text-sm border-b border-gray-100 pb-2 mb-3`}>
                  <CheckCircle className="w-4 h-4" />
                  <h2>RESULTS</h2>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {winners.map((idx, i) => (
                    <div key={idx} className="bg-green-50 border border-green-100 text-[#07C160] rounded p-1.5 text-center relative overflow-hidden group">
                      <span className="text-[10px] absolute top-0 left-1 opacity-60">#{i + 1}</span>
                      <span className="text-base font-bold block mt-2">{idx + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {excludedCells.size > 0 && (
              <button 
                onClick={() => setExcludedCells(new Set())}
                className="w-full py-2 text-xs text-red-500 hover:bg-red-50 rounded border border-transparent hover:border-red-100 transition flex items-center justify-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Clear Exclusions ({excludedCells.size})
              </button>
            )}

          </div>
          
          <div className="p-4 border-t border-gray-100 text-center text-[10px] text-gray-300 uppercase tracking-wider">
             V8 WeChat Edition
          </div>
        </aside>
      </main>
    </div>
  );
}