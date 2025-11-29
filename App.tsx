import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Upload, 
  Trash2, 
  Grid3X3, 
  Users, 
  Play, 
  Trophy, 
  ZoomIn, 
  ZoomOut, 
  Move, 
  MousePointer2, 
  Settings2,
  CheckCircle2,
  X,
  Plus,
  Image as ImageIcon,
  Clock
} from 'lucide-react';

// --- Types ---

interface Selection {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LotteryImage {
  id: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  selection: Selection | null;
  gridRows: number;
  gridCols: number;
  excludedCells: number[]; // Index of excluded cells
  winners: number[]; // Index of winning cells
}

interface WinnerResult {
  imageId: string;
  cellIndex: number;
  imageIndex: number; // 1-based index for display
}

type InteractionMode = 'none' | 'drawing' | 'moving' | 'resizing' | 'panning';
type ResizeHandle = 'tl' | 'tm' | 'tr' | 'mr' | 'br' | 'bm' | 'bl' | 'ml' | null;

const DRAG_THRESHOLD = 5;
const HANDLE_SIZE = 8;
const MIN_GRID_SIZE = 20;

// --- Helper Functions ---

const generateId = () => Math.random().toString(36).substr(2, 9);

// Fisher-Yates Shuffle
const shuffleArray = <T,>(array: T[]): T[] => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// --- Components ---

const App: React.FC = () => {
  // --- State ---
  const [images, setImages] = useState<LotteryImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [winnerCount, setWinnerCount] = useState<number>(1);
  const [animationDuration, setAnimationDuration] = useState<number>(3); // Seconds
  const [isLotteryRunning, setIsLotteryRunning] = useState(false);
  const [tempFlasher, setTempFlasher] = useState<{imageId: string, cellIndex: number} | null>(null);
  const [globalWinners, setGlobalWinners] = useState<WinnerResult[]>([]);
  const [gridColor, setGridColor] = useState<string>('rgba(255, 255, 255, 0.6)');
  
  // Canvas View State
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanningMode, setIsPanningMode] = useState(false);

  // Computed
  const activeImage = useMemo(() => images.find(img => img.id === activeImageId), [images, activeImageId]);
  
  const totalEligibleCount = useMemo(() => {
    return images.reduce((acc, img) => {
      if (!img.selection) return acc;
      const totalCells = img.gridRows * img.gridCols;
      return acc + (totalCells - img.excludedCells.length);
    }, 0);
  }, [images]);

  // --- Handlers ---

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newImages: LotteryImage[] = [];
      Array.from(e.target.files).forEach((file: File) => {
        const src = URL.createObjectURL(file);
        const img = new Image();
        img.src = src;
        img.onload = () => {
          setImages(prev => {
            const next = [...prev, {
              id: generateId(),
              src,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              selection: null, // Start with no selection
              gridRows: 1,
              gridCols: 5,
              excludedCells: [],
              winners: []
            }];
            if (!activeImageId) setActiveImageId(next[0].id);
            return next;
          });
        };
      });
    }
  };

  const removeImage = (id: string) => {
    setImages(prev => {
      const next = prev.filter(img => img.id !== id);
      if (activeImageId === id && next.length > 0) {
        setActiveImageId(next[0].id);
      } else if (next.length === 0) {
        setActiveImageId(null);
      }
      return next;
    });
  };

  const updateActiveImage = (updates: Partial<LotteryImage>) => {
    if (!activeImageId) return;
    setImages(prev => prev.map(img => img.id === activeImageId ? { ...img, ...updates } : img));
  };

  // --- Lottery Logic ---

  const startLottery = useCallback(() => {
    if (totalEligibleCount === 0) {
      alert("没有有效的参与者！请检查网格和排除项。");
      return;
    }
    
    // Clear previous winners
    setImages(prev => prev.map(img => ({ ...img, winners: [] })));
    setGlobalWinners([]);
    setIsLotteryRunning(true);
    setTempFlasher(null);

    // Build the pool of all eligible cells
    // Structure: { imageId, cellIndex, imageIndex }
    const pool: { imageId: string, cellIndex: number, imageIndex: number }[] = [];
    images.forEach((img, idx) => {
      if (!img.selection) return;
      const total = img.gridRows * img.gridCols;
      for (let i = 0; i < total; i++) {
        if (!img.excludedCells.includes(i)) {
          pool.push({ imageId: img.id, cellIndex: i, imageIndex: idx + 1 });
        }
      }
    });

    const startTime = Date.now();
    const durationMs = animationDuration * 1000;
    
    // Animation Loop
    const animate = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      
      if (elapsed < durationMs) {
        // Flash a random cell
        const randomPick = pool[Math.floor(Math.random() * pool.length)];
        setTempFlasher({ imageId: randomPick.imageId, cellIndex: randomPick.cellIndex });
        requestAnimationFrame(animate);
      } else {
        // Finalize
        const shuffledPool = shuffleArray(pool);
        const winners = shuffledPool.slice(0, Math.min(winnerCount, pool.length));
        
        // Update images with winners
        setImages(prev => prev.map(img => {
          const imgWinners = winners
            .filter(w => w.imageId === img.id)
            .map(w => w.cellIndex);
          return { ...img, winners: imgWinners };
        }));
        
        setGlobalWinners(winners.map(w => ({
          imageId: w.imageId,
          cellIndex: w.cellIndex,
          imageIndex: w.imageIndex
        })));
        
        setTempFlasher(null);
        setIsLotteryRunning(false);
      }
    };

    requestAnimationFrame(animate);

  }, [images, totalEligibleCount, winnerCount, animationDuration]);

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-gray-100 overflow-hidden font-sans text-gray-800">
      
      {/* Left/Top: Canvas Area */}
      <div className="relative flex-1 bg-gray-200 overflow-hidden flex flex-col">
        {/* Toolbar */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-white/90 backdrop-blur shadow-lg rounded-full px-4 py-2 flex gap-2 items-center border border-gray-200">
           <button 
            onClick={() => setIsPanningMode(false)}
            className={`p-2 rounded-full transition-colors ${!isPanningMode ? 'bg-wechat text-white' : 'hover:bg-gray-100 text-gray-600'}`}
            title="选择模式"
          >
            <MousePointer2 size={18} />
          </button>
          <button 
            onClick={() => setIsPanningMode(true)}
            className={`p-2 rounded-full transition-colors ${isPanningMode ? 'bg-wechat text-white' : 'hover:bg-gray-100 text-gray-600'}`}
            title="移动视图 (空格键按住)"
          >
            <Move size={18} />
          </button>
          <div className="w-px h-6 bg-gray-300 mx-1"></div>
          <button onClick={() => setScale(s => Math.min(s + 0.1, 5))} className="p-2 hover:bg-gray-100 rounded-full text-gray-600">
            <ZoomIn size={18} />
          </button>
          <span className="text-xs font-medium w-12 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.max(s - 0.1, 0.2))} className="p-2 hover:bg-gray-100 rounded-full text-gray-600">
            <ZoomOut size={18} />
          </button>
           <button onClick={() => { setScale(1); setPan({x:0, y:0}); }} className="ml-2 text-xs text-wechat font-medium hover:underline">
            重置
          </button>
        </div>

        {/* Canvas Container */}
        <div className="flex-1 relative overflow-hidden cursor-crosshair touch-none" id="canvas-container">
           {activeImage ? (
             <CanvasEditor 
                image={activeImage}
                onUpdate={(updates) => updateActiveImage(updates)}
                scale={scale}
                pan={pan}
                setPan={setPan}
                isPanningMode={isPanningMode}
                gridColor={gridColor}
                tempFlasher={tempFlasher?.imageId === activeImage.id ? tempFlasher.cellIndex : null}
                isLotteryRunning={isLotteryRunning}
             />
           ) : (
             <div className="flex items-center justify-center h-full flex-col text-gray-400">
               <ImageIcon size={64} className="mb-4 opacity-50" />
               <p>请上传或选择一张图片开始</p>
             </div>
           )}
        </div>
      </div>

      {/* Right/Bottom: Controls */}
      <div className="w-full md:w-80 bg-white border-l border-gray-200 flex flex-col z-10 shadow-xl">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
          <h1 className="font-bold text-lg text-gray-800 flex items-center gap-2">
            <Trophy className="text-wechat" size={20} />
            抽奖助手
          </h1>
          <div className="text-xs bg-wechat-light text-wechat-dark px-2 py-1 rounded font-medium">
             React v18
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* 1. Image Management */}
          <section>
             <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">图片列表</h2>
             <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                {images.map((img, idx) => (
                  <div 
                    key={img.id}
                    onClick={() => setActiveImageId(img.id)}
                    className={`relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${activeImageId === img.id ? 'border-wechat ring-2 ring-wechat/20' : 'border-transparent hover:border-gray-300'}`}
                  >
                    <img src={img.src} alt="" className="w-full h-full object-cover" />
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
                      className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl hover:bg-red-600"
                    >
                      <X size={10} />
                    </button>
                    <div className="absolute bottom-0 left-0 bg-black/50 text-white text-[10px] px-1 w-full text-center">
                      图 {idx + 1}
                    </div>
                  </div>
                ))}
                
                <label className="flex-shrink-0 w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-wechat hover:bg-wechat-light transition-colors text-gray-400 hover:text-wechat">
                  <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
                  <Plus size={24} />
                </label>
             </div>
          </section>

          {/* 2. Grid Settings (Only if image active) */}
          <section className={`transition-opacity ${!activeImage ? 'opacity-50 pointer-events-none' : ''}`}>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Grid3X3 size={14} /> 网格设置
            </h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">行数 (Rows)</label>
                  <input 
                    type="number" 
                    min={1} 
                    max={50}
                    value={activeImage?.gridRows || 1}
                    onChange={(e) => updateActiveImage({ gridRows: Math.max(1, parseInt(e.target.value) || 1), excludedCells: [], winners: [] })}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 focus:border-wechat focus:ring-1 focus:ring-wechat outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">列数 (Cols)</label>
                  <input 
                    type="number" 
                    min={1} 
                    max={50}
                    value={activeImage?.gridCols || 1}
                    onChange={(e) => updateActiveImage({ gridCols: Math.max(1, parseInt(e.target.value) || 1), excludedCells: [], winners: [] })}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 focus:border-wechat focus:ring-1 focus:ring-wechat outline-none"
                  />
                </div>
              </div>

               <div>
                 <label className="block text-xs text-gray-500 mb-1">网格颜色</label>
                 <div className="flex gap-2">
                   {['rgba(255, 255, 255, 0.6)', 'rgba(0, 0, 0, 0.6)', 'rgba(7, 193, 96, 0.6)', 'rgba(255, 0, 0, 0.6)'].map(color => (
                     <button
                        key={color}
                        onClick={() => setGridColor(color)}
                        className={`w-6 h-6 rounded-full border border-gray-300 ${gridColor === color ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
                        style={{ backgroundColor: color }}
                     />
                   ))}
                 </div>
               </div>
            </div>
          </section>

          {/* 3. Lottery Settings */}
          <section className="pt-4 border-t border-gray-100">
             <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Settings2 size={14} /> 抽奖设置
            </h2>

            <div className="space-y-4">
               <div>
                  <label className="block text-xs text-gray-500 mb-1">中奖人数</label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="range" 
                      min={1} 
                      max={Math.max(1, totalEligibleCount)} 
                      value={winnerCount}
                      onChange={(e) => setWinnerCount(parseInt(e.target.value))}
                      className="flex-1 accent-wechat"
                    />
                    <input 
                      type="number"
                      min={1}
                      max={totalEligibleCount}
                      value={winnerCount}
                      onChange={(e) => setWinnerCount(Math.max(1, parseInt(e.target.value)))}
                      className="w-16 border border-gray-300 rounded px-2 py-1 text-center"
                    />
                  </div>
               </div>

               <div>
                  <label className="block text-xs text-gray-500 mb-1 flex justify-between">
                    <span>动画时长 (秒)</span>
                    <span>{animationDuration}s</span>
                  </label>
                  <div className="flex items-center gap-2">
                     <Clock size={16} className="text-gray-400" />
                     <input 
                      type="range" 
                      min={1} 
                      max={10} 
                      step={0.5}
                      value={animationDuration}
                      onChange={(e) => setAnimationDuration(parseFloat(e.target.value))}
                      className="flex-1 accent-wechat"
                    />
                  </div>
               </div>

               <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                 <div className="flex justify-between items-center mb-1">
                   <span className="text-sm text-gray-600">有效参与数:</span>
                   <span className="font-bold text-wechat text-lg">{totalEligibleCount}</span>
                 </div>
                 <p className="text-[10px] text-gray-400">
                   总格子数: {images.reduce((acc, img) => acc + (img.selection ? img.gridRows * img.gridCols : 0), 0)} | 
                   已排除: {images.reduce((acc, img) => acc + img.excludedCells.length, 0)}
                 </p>
               </div>
            </div>
          </section>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
           <button 
            onClick={startLottery}
            disabled={isLotteryRunning || totalEligibleCount === 0}
            className={`w-full py-3 rounded-lg flex items-center justify-center gap-2 font-bold text-white transition-all transform active:scale-95 shadow-md
              ${isLotteryRunning || totalEligibleCount === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-wechat hover:bg-wechat-dark shadow-wechat/30'}`}
           >
             {isLotteryRunning ? (
               '抽奖中...'
             ) : (
               <>
                 <Play size={20} fill="currentColor" /> 开始抽奖
               </>
             )}
           </button>

           {globalWinners.length > 0 && !isLotteryRunning && (
             <div className="mt-4 animate-fade-in-up">
               <h3 className="font-bold text-gray-700 mb-2 flex items-center gap-2">
                 <CheckCircle2 size={16} className="text-wechat" /> 中奖名单
               </h3>
               <div className="flex flex-wrap gap-2">
                 {globalWinners.map((w, i) => (
                   <div key={i} className="bg-white border border-wechat text-wechat px-3 py-1 rounded shadow-sm text-sm font-medium">
                     图{w.imageIndex} - #{w.cellIndex + 1}
                   </div>
                 ))}
               </div>
             </div>
           )}
        </div>
      </div>
    </div>
  );
};

// --- Canvas Component ---

interface CanvasEditorProps {
  image: LotteryImage;
  onUpdate: (updates: Partial<LotteryImage>) => void;
  scale: number;
  pan: { x: number, y: number };
  setPan: React.Dispatch<React.SetStateAction<{ x: number, y: number }>>;
  isPanningMode: boolean;
  gridColor: string;
  tempFlasher: number | null;
  isLotteryRunning: boolean;
}

const CanvasEditor: React.FC<CanvasEditorProps> = ({ 
  image, 
  onUpdate, 
  scale, 
  pan, 
  setPan, 
  isPanningMode,
  gridColor,
  tempFlasher,
  isLotteryRunning 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Interaction State
  const [mode, setMode] = useState<InteractionMode>('none');
  const [activeHandle, setActiveHandle] = useState<ResizeHandle>(null);
  const [startPos, setStartPos] = useState<{ x: number, y: number }>({ x: 0, y: 0 });
  const [initialSelection, setInitialSelection] = useState<Selection | null>(null);
  const [initialPan, setInitialPan] = useState<{ x: number, y: number } | null>(null);

  // Helper: Map screen coordinates to image coordinates
  const getMousePos = (e: React.PointerEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    return { x, y };
  };

  // Helper: Check if point is inside rect
  const isPointInRect = (x: number, y: number, rect: Selection) => {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  };

  // Helper: Get resize handle at position
  const getHandleAtPos = (x: number, y: number, rect: Selection): ResizeHandle => {
    const r = HANDLE_SIZE / scale; // Scale handle hit area inverse to zoom for UX
    const hw = rect.w;
    const hh = rect.h;
    
    // Check corners
    if (Math.abs(x - rect.x) < r && Math.abs(y - rect.y) < r) return 'tl';
    if (Math.abs(x - (rect.x + hw)) < r && Math.abs(y - rect.y) < r) return 'tr';
    if (Math.abs(x - (rect.x + hw)) < r && Math.abs(y - (rect.y + hh)) < r) return 'br';
    if (Math.abs(x - rect.x) < r && Math.abs(y - (rect.y + hh)) < r) return 'bl';

    // Check edges
    if (Math.abs(x - (rect.x + hw/2)) < r && Math.abs(y - rect.y) < r) return 'tm';
    if (Math.abs(x - (rect.x + hw)) < r && Math.abs(y - (rect.y + hh/2)) < r) return 'mr';
    if (Math.abs(x - (rect.x + hw/2)) < r && Math.abs(y - (rect.y + hh)) < r) return 'bm';
    if (Math.abs(x - rect.x) < r && Math.abs(y - (rect.y + hh/2)) < r) return 'ml';

    return null;
  };

  // --- Drawing Logic ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Load image for drawing
    const imgObj = new Image();
    imgObj.src = image.src;
    
    // We don't need to wait for onload here because parent already did, 
    // but safe to check if it's ready. 
    // Since we are using blob URLs, it should be fast.
    
    const render = () => {
      // Clear
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Draw Image
      ctx.drawImage(imgObj, 0, 0);

      // 2. Draw Overlay (Dark mask outside selection)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      if (image.selection) {
        // Draw 4 rectangles around the selection
        const { x, y, w, h } = image.selection;
        const W = canvas.width;
        const H = canvas.height;

        ctx.beginPath();
        // Outer rect (CW)
        ctx.moveTo(0,0);
        ctx.lineTo(W,0);
        ctx.lineTo(W,H);
        ctx.lineTo(0,H);
        ctx.lineTo(0,0);
        // Inner rect (CCW) -> Creates hole
        ctx.moveTo(x, y);
        ctx.lineTo(x, y+h);
        ctx.lineTo(x+w, y+h);
        ctx.lineTo(x+w, y);
        ctx.lineTo(x, y);
        ctx.fill();

        // 3. Draw Grid
        const cellW = w / image.gridCols;
        const cellH = h / image.gridRows;
        
        ctx.beginPath();
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;

        // Vertical lines
        for(let i=1; i<image.gridCols; i++) {
          ctx.moveTo(x + i*cellW, y);
          ctx.lineTo(x + i*cellW, y + h);
        }
        // Horizontal lines
        for(let i=1; i<image.gridRows; i++) {
          ctx.moveTo(x, y + i*cellH);
          ctx.lineTo(x + w, y + i*cellH);
        }
        ctx.stroke();

        // 4. Draw Excluded Cells
        image.excludedCells.forEach(idx => {
          const r = Math.floor(idx / image.gridCols);
          const c = idx % image.gridCols;
          const cx = x + c * cellW;
          const cy = y + r * cellH;

          // Gray fill
          ctx.fillStyle = 'rgba(100, 100, 100, 0.7)';
          ctx.fillRect(cx, cy, cellW, cellH);
          
          // Red X
          ctx.beginPath();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 2;
          ctx.moveTo(cx + cellW*0.2, cy + cellH*0.2);
          ctx.lineTo(cx + cellW*0.8, cy + cellH*0.8);
          ctx.moveTo(cx + cellW*0.8, cy + cellH*0.2);
          ctx.lineTo(cx + cellW*0.2, cy + cellH*0.8);
          ctx.stroke();
        });

        // 5. Draw Temp Flasher (Animation)
        if (tempFlasher !== null) {
          const r = Math.floor(tempFlasher / image.gridCols);
          const c = tempFlasher % image.gridCols;
          const cx = x + c * cellW;
          const cy = y + r * cellH;

          ctx.strokeStyle = '#ff0000';
          ctx.lineWidth = 4;
          ctx.strokeRect(cx, cy, cellW, cellH);
          ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
          ctx.fillRect(cx, cy, cellW, cellH);
        }

        // 6. Draw Winners (Final)
        image.winners.forEach(idx => {
           const r = Math.floor(idx / image.gridCols);
           const c = idx % image.gridCols;
           const cx = x + c * cellW;
           const cy = y + r * cellH;

           // Thick Red Border
           ctx.strokeStyle = '#ff0000';
           ctx.lineWidth = 5;
           ctx.strokeRect(cx + 2, cy + 2, cellW - 4, cellH - 4);
           
           // Index label
           ctx.fillStyle = '#ff0000';
           ctx.font = 'bold 16px Arial';
           ctx.fillText(`#${idx+1}`, cx + 5, cy + 20);
        });

        // 7. Selection Border & Handles (Only if not running lottery)
        if (!isLotteryRunning) {
          ctx.strokeStyle = '#07C160'; // WeChat Green
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, w, h);

          // Handles
          ctx.fillStyle = 'white';
          ctx.strokeStyle = '#07C160';
          ctx.lineWidth = 1;
          const handleSize = 8 / scale; // Compensate zoom

          const drawHandle = (hx: number, hy: number) => {
            ctx.beginPath();
            ctx.rect(hx - handleSize/2, hy - handleSize/2, handleSize, handleSize);
            ctx.fill();
            ctx.stroke();
          };

          drawHandle(x, y); // TL
          drawHandle(x + w/2, y); // TM
          drawHandle(x + w, y); // TR
          drawHandle(x + w, y + h/2); // MR
          drawHandle(x + w, y + h); // BR
          drawHandle(x + w/2, y + h); // BM
          drawHandle(x, y + h); // BL
          drawHandle(x, y + h/2); // ML
        }

      } else {
        // No selection
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    };

    // Use requestAnimationFrame for smoother updates especially during animation or drag
    let animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);

  }, [image, scale, gridColor, tempFlasher, isLotteryRunning]);


  // --- Event Listeners ---

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    // 1. Pan Mode
    if (isPanningMode || e.button === 1 || e.shiftKey) { // Middle click or shift or mode
      setMode('panning');
      setStartPos({ x: e.clientX, y: e.clientY });
      setInitialPan({ ...pan });
      return;
    }

    if (isLotteryRunning) return;

    const { x, y } = getMousePos(e);
    setStartPos({ x: e.clientX, y: e.clientY }); // Screen pos for drag threshold

    if (image.selection) {
      // Check handles
      const handle = getHandleAtPos(x, y, image.selection);
      if (handle) {
        setMode('resizing');
        setActiveHandle(handle);
        setInitialSelection({ ...image.selection });
        return;
      }

      // Check inside
      if (isPointInRect(x, y, image.selection)) {
        setMode('moving');
        setInitialSelection({ ...image.selection });
        return;
      }
    }

    // Start new selection
    setMode('drawing');
    onUpdate({ 
      selection: { x, y, w: 0, h: 0 },
      excludedCells: [],
      winners: []
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    e.preventDefault();

    if (mode === 'panning' && initialPan) {
      const dx = e.clientX - startPos.x;
      const dy = e.clientY - startPos.y;
      setPan({ x: initialPan.x + dx, y: initialPan.y + dy });
      return;
    }

    const { x, y } = getMousePos(e);
    
    // Cursor handling when hovering
    if (mode === 'none' && !isLotteryRunning && image.selection) {
       const handle = getHandleAtPos(x, y, image.selection);
       if (handle) {
         const cursorMap: Record<string, string> = {
           tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize',
           tm: 'n-resize', bm: 's-resize', ml: 'w-resize', mr: 'e-resize'
         };
         if (canvasRef.current) canvasRef.current.style.cursor = cursorMap[handle];
       } else if (isPointInRect(x, y, image.selection)) {
         if (canvasRef.current) canvasRef.current.style.cursor = 'move';
       } else {
         if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
       }
    }

    if (mode === 'drawing' && image.selection) {
      const w = x - image.selection.x;
      const h = y - image.selection.y;
      onUpdate({ selection: { ...image.selection, w, h } });
    } else if (mode === 'moving' && initialSelection) {
      // Calculate delta in canvas space
      // Note: We need startPos in canvas space for this. 
      // Simplification: We calculate offset from initial mouse down
      const dx = (e.clientX - startPos.x) / scale;
      const dy = (e.clientY - startPos.y) / scale;
      
      let newX = initialSelection.x + dx;
      let newY = initialSelection.y + dy;

      // Boundaries
      newX = Math.max(0, Math.min(newX, image.naturalWidth - initialSelection.w));
      newY = Math.max(0, Math.min(newY, image.naturalHeight - initialSelection.h));

      // Dragging resets exclusions? The prompt says "Move/Resize must clear excludedCells"
      // But we only do it if actual drag occurred (handled in PointerUp logic normally, 
      // but for real-time visual, we can keep exclusion until end or clear now).
      // Prompt: "At the start of dragging, immediately clear excludedCells"
      if (image.excludedCells.length > 0) {
        onUpdate({ excludedCells: [], winners: [] });
      }

      onUpdate({ selection: { ...initialSelection, x: newX, y: newY } });

    } else if (mode === 'resizing' && initialSelection && activeHandle) {
       if (image.excludedCells.length > 0) {
          onUpdate({ excludedCells: [], winners: [] });
       }

       const s = initialSelection;
       // Delta
       const dx = (e.clientX - startPos.x) / scale;
       const dy = (e.clientY - startPos.y) / scale;

       let newX = s.x, newY = s.y, newW = s.w, newH = s.h;

       if (activeHandle.includes('l')) { newX += dx; newW -= dx; }
       if (activeHandle.includes('r')) { newW += dx; }
       if (activeHandle.includes('t')) { newY += dy; newH -= dy; }
       if (activeHandle.includes('b')) { newH += dy; }

       // Flip check
       if (newW < 0) { newX += newW; newW = Math.abs(newW); }
       if (newH < 0) { newY += newH; newH = Math.abs(newH); }

       onUpdate({ selection: { x: newX, y: newY, w: newW, h: newH } });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    // Normalize selection (ensure w/h are positive)
    if (image.selection) {
      const { x, y, w, h } = image.selection;
      const normSel = {
        x: w < 0 ? x + w : x,
        y: h < 0 ? y + h : y,
        w: Math.abs(w),
        h: Math.abs(h)
      };

      // If selection is too small, remove it (accidental click outside)
      if (mode === 'drawing' && (normSel.w < 10 || normSel.h < 10)) {
        onUpdate({ selection: null });
      } else if (mode !== 'none' && mode !== 'panning') {
        onUpdate({ selection: normSel });
      }
    }

    // Click to Toggle Exclusion (Only in 'moving' mode pending check)
    if (mode === 'moving') {
       const dist = Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y);
       if (dist < DRAG_THRESHOLD) {
         // It was a click!
         handleCellClick(e);
       }
    }

    setMode('none');
    setActiveHandle(null);
    setInitialSelection(null);
    setInitialPan(null);
  };

  const handleCellClick = (e: React.PointerEvent) => {
    if (!image.selection) return;
    const { x, y } = getMousePos(e);
    
    // Relative pos
    const rx = x - image.selection.x;
    const ry = y - image.selection.y;
    
    // Cell dims
    const cellW = image.selection.w / image.gridCols;
    const cellH = image.selection.h / image.gridRows;

    const col = Math.floor(rx / cellW);
    const row = Math.floor(ry / cellH);

    if (col >= 0 && col < image.gridCols && row >= 0 && row < image.gridRows) {
       const idx = row * image.gridCols + col;
       const isExcluded = image.excludedCells.includes(idx);
       
       const newExcluded = isExcluded 
         ? image.excludedCells.filter(i => i !== idx)
         : [...image.excludedCells, idx];
       
       // Don't clear winners/exclusion list when clicking to toggle
       onUpdate({ excludedCells: newExcluded });
    }
  };

  // Keyboard Panning (Spacebar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if(e.code === 'Space') setMode(prev => prev === 'none' ? 'panning' : prev); };
    const handleKeyUp = (e: KeyboardEvent) => { if(e.code === 'Space') setMode(prev => prev === 'panning' ? 'none' : prev); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    }
  }, []);


  // Center image on load
  useEffect(() => {
    if (containerRef.current && image.naturalWidth > 0) {
      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight;
      const iw = image.naturalWidth;
      const ih = image.naturalHeight;
      
      // Fit to screen initially
      const fitScale = Math.min(cw / iw, ch / ih) * 0.9;
      // Only set if this is the first load/switch and user hasn't messed with pan too much? 
      // Simplified: Just center offset
      const cx = (cw - iw * fitScale) / 2;
      const cy = (ch - ih * fitScale) / 2;
      
      // We are lifting state up, but for UX, let's just use defaults or passed props
      // NOTE: This effect runs on image change. We might want to reset pan/scale.
      // But parent controls state. We can trigger an update if pan is 0,0
      if (pan.x === 0 && pan.y === 0 && scale === 1) {
         // This is a bit hacky to modify parent state from effect, but standard for "Fit to screen"
         // onUpdate is for image data, not view. 
         // View state is passed in.
      }
    }
  }, [image.id]);

  return (
    <div 
      ref={containerRef} 
      className={`w-full h-full relative overflow-hidden bg-gray-200 select-none ${isPanningMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div 
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          width: image.naturalWidth,
          height: image.naturalHeight,
        }}
        className="relative shadow-2xl transition-transform duration-75 ease-out"
      >
        <canvas
          ref={canvasRef}
          width={image.naturalWidth}
          height={image.naturalHeight}
          className="block"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>
    </div>
  );
};

export default App;