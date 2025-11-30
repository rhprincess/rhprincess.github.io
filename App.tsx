
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
  Clock,
  ChevronUp,
  ChevronDown,
  Menu,
  Layout,
  Undo2,
  Redo2,
  Download,
  FileJson,
  Minus,
  History,
  RotateCcw
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

interface ImageLayout extends LotteryImage {
  worldX: number;
  worldY: number;
}

interface WinnerResult {
  imageId: string;
  cellIndex: number;
  imageIndex: number; // 1-based index for display
}

interface LotteryConfigExport {
  version: string;
  settings: {
    winnerCount: number;
    animationDuration: number;
    gridColor: string;
  };
  images: Array<{
    dataUrl: string;
    naturalWidth: number;
    naturalHeight: number;
    selection: Selection | null;
    gridRows: number;
    gridCols: number;
    excludedCells: number[];
  }>;
}

interface HistoryEntry {
  images: LotteryImage[];
  action: string;
  timestamp: number;
}

type InteractionMode = 'none' | 'drawing' | 'moving' | 'resizing' | 'panning';
type ResizeHandle = 'tl' | 'tm' | 'tr' | 'mr' | 'br' | 'bm' | 'bl' | 'ml' | null;

const DRAG_THRESHOLD = 5;
const HANDLE_SIZE = 8;
const IMAGE_GAP = 100; // Gap between images in infinite canvas

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

// Calculate layout for infinite canvas
const getImagesLayout = (images: LotteryImage[]): { layouts: ImageLayout[], totalWidth: number, maxHeight: number } => {
  let currentX = 0;
  let maxHeight = 0;
  const layouts = images.map(img => {
    const layout = { ...img, worldX: currentX, worldY: 0 };
    currentX += img.naturalWidth + IMAGE_GAP;
    maxHeight = Math.max(maxHeight, img.naturalHeight);
    return layout;
  });
  return { layouts, totalWidth: currentX, maxHeight };
};

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

const formatTime = (ts: number) => {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
};

// --- Custom Slider Component (Fixes Mobile Dragging & Overflow) ---
interface CustomSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  className?: string;
}

const CustomSlider: React.FC<CustomSliderProps> = ({ value, min, max, step = 1, onChange, className = "" }) => {
  const ref = useRef<HTMLDivElement>(null);
  const PADDING = 12; // Half thumb width (w-6 = 24px)

  const update = (e: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    
    // Effective width for the slider track logic is reduced by padding
    const effectiveWidth = rect.width - (PADDING * 2);
    // X relative to the start of the effective track
    const x = Math.max(0, Math.min(e.clientX - rect.left - PADDING, effectiveWidth));
    
    const pct = x / effectiveWidth;
    let val = min + pct * (max - min);
    
    // Snap
    if (step) val = Math.round(val / step) * step;
    val = Math.max(min, Math.min(max, val));
    onChange(val);
  };

  return (
    <div 
      ref={ref}
      // Added w-full to prevent overflow
      className={`relative h-10 w-full flex items-center select-none touch-none cursor-pointer group px-[12px] ${className}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => {
        e.preventDefault();
        if (e.buttons === 1) update(e);
      }}
    >
      {/* Track */}
      <div className="absolute inset-x-3 h-2 bg-white/40 backdrop-blur-sm rounded-full overflow-hidden border border-white/40 shadow-inner">
         <div 
           className="h-full bg-gradient-to-r from-wechat-light to-wechat transition-all duration-75 ease-out shadow-[0_0_10px_rgba(7,193,96,0.5)]" 
           style={{ width: `${(value - min) / (max - min) * 100}%` }} 
         />
      </div>
      {/* Thumb */}
      <div 
        className="absolute h-6 w-6 bg-white border border-white/60 shadow-[0_4px_12px_rgba(0,0,0,0.15)] rounded-full top-1/2 -translate-y-1/2 -translate-x-1/2 transition-transform group-active:scale-110 backdrop-blur-md flex items-center justify-center"
        style={{ left: `calc(12px + ${(value - min) / (max - min)} * (100% - 24px))` }}
      >
        <div className="w-2 h-2 rounded-full bg-wechat/50"></div>
      </div>
    </div>
  );
};

// --- Confetti Component ---
interface ConfettiSystemProps {
  origin?: { x: number, y: number };
}

const ConfettiSystem: React.FC<ConfettiSystemProps> = ({ origin }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const startX = origin ? origin.x : window.innerWidth / 2;
    const startY = origin ? origin.y : window.innerHeight / 2;

    const particles: {
      x: number; y: number; vx: number; vy: number; 
      color: string; size: number; rotation: number; vRotation: number;
    }[] = [];

    const colors = ['#07C160', '#FFD700', '#FF4136', '#0074D9', '#FF851B'];

    for (let i = 0; i < 150; i++) {
      particles.push({
        x: startX,
        y: startY,
        vx: (Math.random() - 0.5) * 20, // Spread out more
        vy: (Math.random() - 1) * 20 - 5, // Upwards burst
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 8 + 4,
        rotation: Math.random() * 360,
        vRotation: (Math.random() - 0.5) * 10
      });
    }

    let animationId: number;
    const gravity = 0.4;
    const drag = 0.96;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.vy += gravity;
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vRotation;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }

      if (particles.length > 0 && particles.some(p => p.y < canvas.height + 20)) {
         animationId = requestAnimationFrame(render);
      }
    };

    render();

    const timer = setTimeout(() => {
       cancelAnimationFrame(animationId);
    }, 5000);

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, [origin]); // Re-run if origin changes (though usually mounts once)

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-[100]" />;
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
  const [showConfetti, setShowConfetti] = useState(false);
  const [isWinnersExpanded, setIsWinnersExpanded] = useState(true);
  
  // History State
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  
  // Canvas View State
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanningMode, setIsPanningMode] = useState(false);

  // Mobile UI State
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const [isMobileResultsOpen, setIsMobileResultsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'images' | 'settings' | 'history'>('settings');

  // Desktop UI State
  const [desktopTab, setDesktopTab] = useState<'images' | 'settings' | 'history'>('settings');

  // Computed
  const activeImage = useMemo(() => images.find(img => img.id === activeImageId), [images, activeImageId]);
  
  const { layouts: imageLayouts } = useMemo(() => getImagesLayout(images), [images]);

  // Calculate center of active image for confetti
  const activeImageCenter = useMemo(() => {
    if (!activeImageId) return { x: window.innerWidth/2, y: window.innerHeight/2 };
    const layout = imageLayouts.find(l => l.id === activeImageId);
    if (!layout) return { x: window.innerWidth/2, y: window.innerHeight/2 };
    
    const canvasContainer = document.getElementById('canvas-container');
    const rect = canvasContainer?.getBoundingClientRect();
    const offsetX = rect ? rect.left : 0;
    const offsetY = rect ? rect.top : 0;

    const centerX = offsetX + pan.x + (layout.worldX + layout.naturalWidth / 2) * scale;
    const centerY = offsetY + pan.y + (layout.worldY + layout.naturalHeight / 2) * scale;
    
    return { x: centerX, y: centerY };
  }, [activeImageId, imageLayouts, pan, scale]);

  const totalEligibleCount = useMemo(() => {
    return images.reduce((acc, img) => {
      if (!img.selection) return acc;
      const totalCells = img.gridRows * img.gridCols;
      return acc + (totalCells - img.excludedCells.length);
    }, 0);
  }, [images]);

  // --- History Actions ---
  const saveHistory = useCallback((action: string, overrideImages?: LotteryImage[]) => {
    setHistory(prev => {
      const newEntry = { 
        images: overrideImages || images, 
        action, 
        timestamp: Date.now() 
      };
      const newHist = [...prev, newEntry];
      if (newHist.length > 100) return newHist.slice(newHist.length - 100);
      return newHist;
    });
    setFuture([]); 
  }, [images]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1]; 
    const newHistory = history.slice(0, -1);
    
    setFuture(prev => [{ images, action: '撤销前状态', timestamp: Date.now() }, ...prev]);
    
    if (newHistory.length > 0) {
      setImages(newHistory[newHistory.length - 1].images);
      setHistory(newHistory);
    } else {
       if (history.length === 1) {
           setImages([]); 
           setHistory([]);
       }
    }
  }, [history, images]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);

    setHistory(prev => [...prev, { images: next.images, action: '重做', timestamp: Date.now() }]);
    setImages(next.images);
    setFuture(newFuture);
  }, [future]);

  const restoreHistory = (index: number) => {
    const entry = history[index];
    if (!entry) return;

    const newImages = entry.images;
    setImages(newImages);
    
    setHistory(prev => [
      ...prev, 
      { 
        images: newImages, 
        action: `恢复: ${entry.action}`, 
        timestamp: Date.now() 
      }
    ]);
    setFuture([]); 
    
    if (window.innerWidth < 768) {
      setIsMobileSettingsOpen(false);
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !isLotteryRunning) {
        if (e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
        } else if (e.key === 'y') {
          e.preventDefault();
          redo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, isLotteryRunning]);

  // --- Helpers ---
  const zoomToImage = useCallback((imgId: string) => {
    const layout = imageLayouts.find(l => l.id === imgId);
    if (!layout) return;

    const containerW = window.innerWidth; 
    const containerH = window.innerHeight; 
    const isMobile = window.innerWidth < 768;
    const viewW = isMobile ? containerW : containerW - 320; 
    const viewH = isMobile ? containerH - 64 : containerH; 

    const padding = 40;
    const fitScale = Math.min(
      (viewW - padding * 2) / layout.naturalWidth, 
      (viewH - padding * 2) / layout.naturalHeight
    );
    
    const finalScale = Math.min(Math.max(fitScale, 0.1), 2);
    const centerX = (viewW - layout.naturalWidth * finalScale) / 2;
    const centerY = (viewH - layout.naturalHeight * finalScale) / 2;

    setScale(finalScale);
    setPan({
      x: centerX - layout.worldX * finalScale,
      y: centerY - layout.worldY * finalScale
    });
  }, [imageLayouts]);

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
            const nextId = generateId();
            const next = [...prev, {
              id: nextId,
              src,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              selection: null, 
              gridRows: 1,
              gridCols: 5,
              excludedCells: [],
              winners: []
            }];
            return next;
          });
        };
      });
      
      setTimeout(() => {
         setImages(current => {
           saveHistory('导入图片', current);
           if (current.length > 0) setActiveImageId(current[current.length - 1].id);
           return current;
         });
      }, 200);
    }
  };

  const removeImage = (id: string) => {
    setImages(prev => {
      const next = prev.filter(img => img.id !== id);
      saveHistory('删除图片', next);
      if (activeImageId === id) {
        setActiveImageId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
  };

  const updateActiveImage = (updates: Partial<LotteryImage>) => {
    if (!activeImageId) return;
    setImages(prev => prev.map(img => img.id === activeImageId ? { ...img, ...updates } : img));
  };

  const handleSelectImage = (id: string) => {
    setActiveImageId(id);
    zoomToImage(id);
  };

  // --- Export / Import Logic ---
  
  const handleExportConfig = async () => {
    try {
      const imagesExportData = await Promise.all(images.map(async (img) => {
        const response = await fetch(img.src);
        const blob = await response.blob();
        const base64 = await blobToBase64(blob);
        
        return {
          dataUrl: base64,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          selection: img.selection,
          gridRows: img.gridRows,
          gridCols: img.gridCols,
          excludedCells: img.excludedCells
        };
      }));

      const exportData: LotteryConfigExport = {
        version: '1.0',
        settings: {
          winnerCount,
          animationDuration,
          gridColor
        },
        images: imagesExportData
      };

      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `lottery-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export failed:", error);
      alert("导出配置失败，请重试。");
    }
  };

  const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = event.target?.result as string;
        const config: LotteryConfigExport = JSON.parse(json);

        if (!config.version || !config.images) {
          throw new Error("Invalid configuration file format");
        }

        setWinnerCount(config.settings.winnerCount);
        setAnimationDuration(config.settings.animationDuration);
        setGridColor(config.settings.gridColor);

        const restoredImages: LotteryImage[] = await Promise.all(config.images.map(async (imgData) => {
          const res = await fetch(imgData.dataUrl);
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          
          return {
            id: generateId(),
            src: objectUrl,
            naturalWidth: imgData.naturalWidth,
            naturalHeight: imgData.naturalHeight,
            selection: imgData.selection,
            gridRows: imgData.gridRows,
            gridCols: imgData.gridCols,
            excludedCells: imgData.excludedCells,
            winners: [] 
          };
        }));

        setImages(restoredImages);
        saveHistory('导入配置', restoredImages);

        if (restoredImages.length > 0) {
          setActiveImageId(restoredImages[0].id);
        } else {
          setActiveImageId(null);
        }
        setGlobalWinners([]);
        alert("配置导入成功！");

      } catch (error) {
        console.error("Import failed:", error);
        alert("导入失败：文件格式错误或已损坏。");
      }
    };
    reader.readAsText(file);
    e.target.value = ''; 
  };


  useEffect(() => {
    if (images.length === 1 && activeImageId === images[0].id) {
       zoomToImage(images[0].id);
    }
  }, [images.length]); 

  // --- Lottery Logic ---

  const startLottery = useCallback(() => {
    if (totalEligibleCount === 0) {
      alert("没有有效的参与者！请检查网格和排除项。");
      return;
    }
    
    setIsMobileSettingsOpen(false);
    setIsMobileResultsOpen(false);
    setShowConfetti(false);
    setIsWinnersExpanded(true); // Auto expand on desktop

    setImages(prev => prev.map(img => ({ ...img, winners: [] })));
    setGlobalWinners([]);
    setIsLotteryRunning(true);
    setTempFlasher(null);

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
    
    const animate = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      
      if (elapsed < durationMs) {
        const randomPick = pool[Math.floor(Math.random() * pool.length)];
        setTempFlasher({ imageId: randomPick.imageId, cellIndex: randomPick.cellIndex });
        requestAnimationFrame(animate);
      } else {
        const shuffledPool = shuffleArray(pool);
        const winners = shuffledPool.slice(0, Math.min(winnerCount, pool.length));
        
        setImages(prev => {
          const next = prev.map(img => {
            const imgWinners = winners
              .filter(w => w.imageId === img.id)
              .map(w => w.cellIndex);
            return { ...img, winners: imgWinners };
          });
          return next;
        });
        
        setGlobalWinners(winners.map(w => ({
          imageId: w.imageId,
          cellIndex: w.cellIndex,
          imageIndex: w.imageIndex
        })));
        
        setTempFlasher(null);
        setIsLotteryRunning(false);
        setIsMobileResultsOpen(true);
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 5000);
      }
    };

    requestAnimationFrame(animate);

  }, [images, totalEligibleCount, winnerCount, animationDuration, saveHistory]);


  // --- Render Parts ---

  const ImageList = () => (
    <div className="flex flex-wrap gap-3">
      {images.map((img, idx) => (
        <div 
          key={img.id}
          onClick={() => handleSelectImage(img.id)}
          // Use border-4 inside box-sizing instead of ring to prevent corner leak
          className={`relative flex-shrink-0 w-20 h-20 rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 active:scale-95 box-border
            ${activeImageId === img.id 
              ? 'scale-90 border-4 border-wechat shadow-lg shadow-wechat/30' 
              : 'border border-white/30 hover:border-white/80 hover:scale-105 shadow-sm'}`}
        >
          <img src={img.src} alt="" className="w-full h-full object-cover" />
          <button 
            onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
            className="absolute top-0 right-0 bg-red-500/60 backdrop-blur-md text-white p-1 rounded-bl-xl hover:bg-red-600/80 z-10 transition-colors"
          >
            <X size={12} />
          </button>
          <div className="absolute bottom-0 left-0 bg-black/30 backdrop-blur-md text-white text-[10px] px-1 w-full text-center truncate py-0.5">
            图 {idx + 1}
          </div>
        </div>
      ))}
      
      <label className="flex-shrink-0 w-20 h-20 rounded-2xl border-2 border-dashed border-white/50 flex flex-col items-center justify-center cursor-pointer hover:border-wechat hover:bg-wechat/5 transition-all text-gray-400 hover:text-wechat bg-white/20 backdrop-blur-sm shadow-inner group active:scale-95 duration-300">
        <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
        <Plus size={24} className="group-hover:scale-110 transition-transform" />
        <span className="text-[10px] mt-1 font-medium">添加图片</span>
      </label>
    </div>
  );

  const HistoryList = () => (
    <div className="space-y-3">
      {history.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-gray-400">
           <div className="bg-white/30 p-4 rounded-full mb-3 backdrop-blur-sm">
              <History size={24} className="opacity-50" />
           </div>
           <p className="text-sm">暂无历史记录</p>
        </div>
      ) : (
        [...history].reverse().map((entry, index) => {
          const originalIndex = history.length - 1 - index;
          const isCurrent = originalIndex === history.length - 1;
          
          return (
            <div 
              key={index} 
              onClick={() => restoreHistory(originalIndex)}
              className={`flex items-center justify-between p-3.5 rounded-2xl cursor-pointer transition-all duration-300 border active:scale-95
                ${isCurrent 
                  ? 'bg-wechat/10 border-wechat/30 shadow-lg shadow-wechat/10' 
                  : 'bg-white/40 border-white/40 hover:bg-white/60 hover:shadow-md hover:scale-[1.02]'}`}
            >
              <div className="flex items-center gap-3">
                 <div className={`w-9 h-9 rounded-full flex items-center justify-center shadow-inner text-white
                    ${isCurrent ? 'bg-gradient-to-br from-wechat to-wechat-dark' : 'bg-gray-200'}`}>
                    {isCurrent ? <CheckCircle2 size={16} /> : <RotateCcw size={16} className="text-gray-500" />}
                 </div>
                 <div>
                    <p className={`text-sm font-bold ${isCurrent ? 'text-wechat-dark' : 'text-gray-700'}`}>{entry.action}</p>
                    <p className="text-xs text-gray-400 font-medium">{formatTime(entry.timestamp)}</p>
                 </div>
              </div>
              {!isCurrent && (
                <button className="text-xs text-wechat font-bold px-3 py-1.5 bg-white/60 border border-wechat/20 rounded-xl hover:bg-wechat hover:text-white transition-colors shadow-sm backdrop-blur-sm">
                   恢复
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  const NumberControl = ({ label, value, onChange, min, max }: { label: string, value: number, onChange: (val: number) => void, min: number, max: number }) => (
    <div>
      <label className="block text-xs font-bold text-gray-500/80 mb-2 uppercase tracking-wide">{label}</label>
      <div className="flex items-center border border-white/50 rounded-xl overflow-hidden h-10 shadow-sm bg-white/40 backdrop-blur-md">
        <button 
          onClick={() => onChange(Math.max(min, value - 1))}
          className="px-3 bg-white/30 hover:bg-white/60 active:bg-white/80 border-r border-white/30 text-gray-600 h-full flex items-center justify-center transition-colors active:scale-95"
        >
          <Minus size={14} />
        </button>
        <input 
          type="number" 
          className="w-full text-center outline-none text-sm appearance-none bg-transparent h-full font-bold text-gray-700"
          value={value}
          onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
          min={min} max={max}
        />
        <button 
          onClick={() => onChange(Math.min(max, value + 1))}
          className="px-3 bg-white/30 hover:bg-white/60 active:bg-white/80 border-l border-white/30 text-gray-600 h-full flex items-center justify-center transition-colors active:scale-95"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );

  const SettingsPanel = () => (
    <div className="space-y-8">
       <section className={`transition-all duration-300 ${!activeImage ? 'opacity-50 grayscale pointer-events-none' : ''}`}>
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500"><Grid3X3 size={14} /></div> 当前图片网格
        </h2>
        
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
             <NumberControl 
                label="行数 (Rows)"
                value={activeImage?.gridRows || 1}
                min={1} max={50}
                onChange={(val) => {
                  setImages(prev => {
                    const next = prev.map(img => img.id === activeImageId ? { ...img, gridRows: val, excludedCells: [], winners: [] } : img);
                    saveHistory('调整网格行数', next);
                    return next;
                  });
                }}
             />
             <NumberControl 
                label="列数 (Cols)"
                value={activeImage?.gridCols || 1}
                min={1} max={50}
                onChange={(val) => {
                  setImages(prev => {
                    const next = prev.map(img => img.id === activeImageId ? { ...img, gridCols: val, excludedCells: [], winners: [] } : img);
                    saveHistory('调整网格列数', next);
                    return next;
                  });
                }}
             />
          </div>

            <div>
              <label className="block text-xs font-bold text-gray-500/80 mb-2 uppercase tracking-wide">网格颜色</label>
              <div className="flex gap-3 bg-white/30 p-2 rounded-2xl border border-white/40 inline-flex backdrop-blur-sm">
                {['rgba(255, 255, 255, 0.6)', 'rgba(0, 0, 0, 0.6)', 'rgba(7, 193, 96, 0.6)', 'rgba(255, 0, 0, 0.6)'].map(color => (
                  <button
                    key={color}
                    onClick={() => setGridColor(color)}
                    className={`w-7 h-7 rounded-full border border-white/60 shadow-lg transition-all duration-300 active:scale-95 flex items-center justify-center
                       ${gridColor === color ? 'ring-2 ring-offset-2 ring-offset-white/50 ring-blue-400 scale-110' : 'hover:scale-105'}`}
                    style={{ backgroundColor: color }}
                  >
                    {gridColor === color && <div className="w-2 h-2 rounded-full bg-white shadow-sm"></div>}
                  </button>
                ))}
              </div>
            </div>
        </div>
      </section>

      <section className="pt-6 border-t border-white/30">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
           <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-500"><Settings2 size={14} /></div> 全局抽奖设置
        </h2>

        <div className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-gray-500/80 mb-2 uppercase tracking-wide">中奖人数</label>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <CustomSlider 
                    min={1} 
                    max={Math.max(1, totalEligibleCount)} 
                    value={winnerCount}
                    onChange={(val) => setWinnerCount(val)}
                  />
                </div>
                <div className="w-14 h-10 border border-white/50 rounded-xl flex items-center justify-center text-sm font-bold bg-white/40 backdrop-blur-md shadow-inner text-gray-700 flex-shrink-0">
                   {winnerCount}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500/80 mb-2 uppercase tracking-wide flex justify-between">
                <span>动画时长 (秒)</span>
                <span className="text-wechat">{animationDuration}s</span>
              </label>
              <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center flex-shrink-0">
                     <Clock size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CustomSlider 
                      min={1} 
                      max={10} 
                      step={0.5}
                      value={animationDuration}
                      onChange={(val) => setAnimationDuration(val)}
                    />
                  </div>
              </div>
            </div>

            <div className="bg-white/40 backdrop-blur-xl p-4 rounded-3xl border border-white/60 shadow-lg shadow-blue-500/5">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-bold text-gray-600">有效参与数</span>
                <span className="font-black text-2xl text-transparent bg-clip-text bg-gradient-to-r from-wechat to-blue-500">{totalEligibleCount}</span>
              </div>
              <div className="flex justify-between text-[11px] text-gray-500 font-medium bg-white/30 p-2 rounded-xl">
                 <span>总格子: {images.reduce((acc, img) => acc + (img.selection ? img.gridRows * img.gridCols : 0), 0)}</span>
                 <span className="w-px h-3 bg-gray-400/30"></span>
                 <span>已排除: {images.reduce((acc, img) => acc + img.excludedCells.length, 0)}</span>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button 
                onClick={handleExportConfig}
                className="flex items-center justify-center gap-2 px-3 py-3 border border-white/50 rounded-2xl text-xs font-bold text-gray-600 bg-white/40 hover:bg-white/70 hover:text-wechat hover:shadow-lg hover:border-wechat/30 transition-all backdrop-blur-md active:scale-95"
              >
                <Download size={16} /> 导出配置
              </button>
              <label className="flex items-center justify-center gap-2 px-3 py-3 border border-white/50 rounded-2xl text-xs font-bold text-gray-600 bg-white/40 hover:bg-white/70 hover:text-wechat hover:shadow-lg hover:border-wechat/30 transition-all backdrop-blur-md cursor-pointer active:scale-95 duration-300">
                <FileJson size={16} /> 导入配置
                <input 
                  type="file" 
                  accept=".json" 
                  onChange={handleImportConfig} 
                  className="hidden" 
                />
              </label>
            </div>
        </div>
      </section>
    </div>
  );

  return (
    <div className="flex flex-col md:flex-row h-screen w-full overflow-hidden font-sans text-gray-800 bg-[#f0f2f5] relative selection:bg-wechat/30">
      <div className="absolute inset-0 z-0 pointer-events-none" 
           style={{
             background: `
               radial-gradient(circle at 15% 50%, rgba(7, 193, 96, 0.08), transparent 40%), 
               radial-gradient(circle at 85% 30%, rgba(59, 130, 246, 0.08), transparent 40%),
               radial-gradient(circle at 50% 80%, rgba(236, 72, 153, 0.08), transparent 40%)
             `
           }}
      />
      <style>
        {`
          .no-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
          .custom-scrollbar::-webkit-scrollbar {
             width: 5px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
             background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
             background: rgba(0,0,0,0.1);
             border-radius: 10px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
             background: rgba(0,0,0,0.2);
          }
          .glass-panel {
             background: rgba(255, 255, 255, 0.6);
             backdrop-filter: blur(24px);
             -webkit-backdrop-filter: blur(24px);
             border: 1px solid rgba(255, 255, 255, 0.4);
          }
        `}
      </style>
      
      {showConfetti && <ConfettiSystem origin={activeImageCenter} />}
      
      {/* Canvas Area */}
      <div className="absolute inset-0 md:relative md:flex-1 overflow-hidden flex flex-col z-0">
        {/* Floating Toolbar */}
        <div className="
          z-20 flex gap-2 items-center pointer-events-auto
          fixed top-0 left-0 right-0 glass-panel px-4 py-3 overflow-x-auto no-scrollbar
          md:absolute md:top-6 md:left-1/2 md:-translate-x-1/2 md:w-auto md:rounded-full md:shadow-[0_8px_32px_rgba(0,0,0,0.08)] md:py-2.5 md:px-6
        ">
           <div className="md:hidden flex gap-2 border-r border-gray-400/20 pr-3 mr-1">
             <button onClick={undo} disabled={history.length === 0} className={`p-2.5 rounded-full bg-white/40 hover:bg-white/80 transition-all active:scale-95 duration-300 ${history.length === 0 ? 'opacity-30' : ''}`}><Undo2 size={18}/></button>
             <button onClick={redo} disabled={future.length === 0} className={`p-2.5 rounded-full bg-white/40 hover:bg-white/80 transition-all active:scale-95 duration-300 ${future.length === 0 ? 'opacity-30' : ''}`}><Redo2 size={18}/></button>
           </div>

           <button 
            onClick={() => setIsPanningMode(false)}
            className={`p-2.5 rounded-full transition-all duration-300 shadow-sm active:scale-95 ${!isPanningMode ? 'bg-wechat text-white shadow-wechat/30 scale-110' : 'bg-white/40 hover:bg-white/80 text-gray-600'}`}
            title="选择模式"
          >
            <MousePointer2 size={18} />
          </button>
          <button 
            onClick={() => setIsPanningMode(true)}
            className={`p-2.5 rounded-full transition-all duration-300 shadow-sm active:scale-95 ${isPanningMode ? 'bg-wechat text-white shadow-wechat/30 scale-110' : 'bg-white/40 hover:bg-white/80 text-gray-600'}`}
            title="移动视图 (空格键按住)"
          >
            <Move size={18} />
          </button>
          <div className="w-px h-6 bg-gray-400/20 mx-2 flex-shrink-0"></div>
          <button onClick={() => setScale(s => Math.min(s + 0.05, 5))} className="p-2.5 hover:bg-white/80 bg-white/40 rounded-full text-gray-700 flex-shrink-0 transition-all active:scale-95 duration-300">
            <ZoomIn size={18} />
          </button>
          <span className="text-xs font-bold w-12 text-center flex-shrink-0 tabular-nums text-gray-600 bg-white/30 py-1 rounded-lg">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.max(s - 0.05, 0.2))} className="p-2.5 hover:bg-white/80 bg-white/40 rounded-full text-gray-700 flex-shrink-0 transition-all active:scale-95 duration-300">
            <ZoomOut size={18} />
          </button>
           <button onClick={() => { if(activeImageId) zoomToImage(activeImageId); else { setScale(1); setPan({x:0, y:0}); } }} className="ml-4 text-xs text-wechat font-bold hover:bg-wechat hover:text-white transition-all flex-shrink-0 whitespace-nowrap bg-wechat/10 px-4 py-2 rounded-full border border-wechat/20 active:scale-95 duration-300">
            重置
          </button>
        </div>

        <div className="flex-1 relative overflow-hidden cursor-crosshair touch-none" id="canvas-container">
             {images.length === 0 ? (
               <div className="flex items-center justify-center h-full flex-col text-gray-400 p-8 text-center pointer-events-none">
                 <div className="bg-white/40 p-8 rounded-[2rem] mb-6 shadow-xl shadow-blue-500/5 backdrop-blur-md border border-white/50">
                   <ImageIcon size={64} className="opacity-40 text-gray-500" />
                 </div>
                 <p className="text-xl font-bold text-gray-600/80 tracking-tight">准备开始</p>
                 <p className="text-sm mt-2 text-gray-400 font-medium">点击右侧(桌面)或下方(手机)添加图片</p>
               </div>
             ) : (
               <CanvasEditor 
                  imageLayouts={imageLayouts}
                  activeImageId={activeImageId}
                  onUpdate={(id, updates) => {
                    setImages(prev => {
                      const next = prev.map(img => img.id === id ? { ...img, ...updates } : img);
                      return next;
                    });
                  }}
                  onSelectImage={handleSelectImage}
                  onInteractionStart={(action) => {
                    saveHistory(action);
                  }}
                  scale={scale}
                  setScale={setScale}
                  pan={pan}
                  setPan={setPan}
                  setMode={(m) => {
                    // Helper to force mode, e.g. continue panning
                  }}
                  isPanningMode={isPanningMode}
                  gridColor={gridColor}
                  tempFlasher={tempFlasher}
                  isLotteryRunning={isLotteryRunning}
               />
             )}
        </div>
      </div>

      {/* --- Desktop Sidebar --- */}
      <div className="hidden md:flex w-96 glass-panel border-l-0 md:border-l flex-col z-10 shadow-[0_0_40px_rgba(0,0,0,0.05)] relative h-full overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-white/30 flex-shrink-0 bg-white/30">
          <h1 className="font-black text-xl text-gray-800 flex items-center gap-3 mb-5">
             <div className="bg-gradient-to-br from-wechat to-[#05a350] text-white p-2 rounded-xl shadow-lg shadow-wechat/30">
               <Trophy size={20} />
             </div>
             <span className="bg-gradient-to-r from-gray-800 to-gray-500 bg-clip-text text-transparent tracking-tight">抽奖助手</span>
          </h1>
          
          {/* Desktop Tabs */}
          <div className="flex bg-gray-200/40 p-1.5 rounded-2xl backdrop-blur-sm shadow-inner">
            <button 
              onClick={() => setDesktopTab('images')}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all duration-300 ${desktopTab === 'images' ? 'bg-white text-wechat shadow-lg shadow-gray-200/50' : 'text-gray-500 hover:text-gray-700 hover:bg-white/30 active:scale-95'}`}
            >
              图片
            </button>
            <button 
              onClick={() => setDesktopTab('settings')}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all duration-300 ${desktopTab === 'settings' ? 'bg-white text-wechat shadow-lg shadow-gray-200/50' : 'text-gray-500 hover:text-gray-700 hover:bg-white/30 active:scale-95'}`}
            >
              设置
            </button>
            <button 
              onClick={() => setDesktopTab('history')}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all duration-300 ${desktopTab === 'history' ? 'bg-white text-wechat shadow-lg shadow-gray-200/50' : 'text-gray-500 hover:text-gray-700 hover:bg-white/30 active:scale-95'}`}
            >
              记录
            </button>
          </div>
        </div>

        {/* Content - Fixed Scroll Area */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 custom-scrollbar">
           {desktopTab === 'images' && <ImageList />}
           {desktopTab === 'settings' && <SettingsPanel />}
           {desktopTab === 'history' && <HistoryList />}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-white/40 bg-white/40 flex-shrink-0 space-y-4 backdrop-blur-md">
           {/* Desktop Undo/Redo/Reset Controls */}
           <div className="flex items-center justify-between text-gray-500 text-xs px-1">
             <div className="flex gap-2">
                <button onClick={undo} disabled={history.length === 0} className="hover:text-wechat disabled:opacity-30 transition-all duration-300 p-2 rounded-xl hover:bg-white/60 bg-white/20 border border-white/40 active:scale-95" title="撤销"><Undo2 size={16} /></button>
                <button onClick={redo} disabled={future.length === 0} className="hover:text-wechat disabled:opacity-30 transition-all duration-300 p-2 rounded-xl hover:bg-white/60 bg-white/20 border border-white/40 active:scale-95" title="重做"><Redo2 size={16} /></button>
             </div>
             <button onClick={() => { setScale(1); setPan({x:0, y:0}); }} className="flex items-center gap-1 hover:text-wechat transition-all duration-300 px-3 py-2 rounded-xl hover:bg-white/60 bg-white/20 border border-white/40 font-bold active:scale-95" title="重置视图">
               <RotateCcw size={14} /> 重置视图
             </button>
           </div>

           <button 
            onClick={startLottery}
            disabled={isLotteryRunning || totalEligibleCount === 0}
            className={`w-full py-4 rounded-[1.2rem] flex items-center justify-center gap-2 font-bold text-white transition-all transform active:scale-[0.98] shadow-xl text-lg relative overflow-hidden group
              ${isLotteryRunning || totalEligibleCount === 0 ? 'bg-gray-400 cursor-not-allowed shadow-none opacity-60' : 'bg-gradient-to-r from-wechat to-[#05a350] hover:brightness-105 shadow-wechat/40'}`}
           >
             <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
             {isLotteryRunning ? '抽奖中...' : <><Play size={22} fill="currentColor" className="relative z-10" /> <span className="relative z-10">开始抽奖</span></>}
           </button>

           {globalWinners.length > 0 && !isLotteryRunning && (
             <div className="animate-fade-in-up">
               <button 
                 onClick={() => setIsWinnersExpanded(!isWinnersExpanded)}
                 className="w-full font-bold text-gray-700 mb-2 flex items-center justify-between text-xs uppercase tracking-wider bg-white/30 p-2 rounded-xl hover:bg-white/50 transition-colors"
               >
                 <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-wechat" /> 中奖名单 ({globalWinners.length})
                 </div>
                 {isWinnersExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
               </button>
               
               <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isWinnersExpanded ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'}`}>
                   <div 
                      className="grid grid-rows-5 grid-flow-col gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-300/50 pt-1"
                      style={{ maxHeight: '180px' }} 
                    >
                     {globalWinners.map((w, i) => (
                       <div 
                        key={i} 
                        className="w-24 flex-shrink-0 bg-white/60 border border-white/60 text-wechat-dark px-2 py-2 rounded-xl shadow-sm text-xs font-bold text-center whitespace-nowrap hover:bg-white hover:scale-105 transition-all cursor-default backdrop-blur-sm"
                        title={`图${w.imageIndex} - 格子 #${w.cellIndex + 1}`}
                       >
                         图{w.imageIndex} - #{w.cellIndex + 1}
                       </div>
                     ))}
                   </div>
               </div>
             </div>
           )}
        </div>
      </div>

      {/* --- Mobile Bottom Bar --- */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex flex-col justify-end pointer-events-none">
        {/* Mobile Results Popup (Absolute positioned to avoid layout jumping) */}
         <div className={`
             glass-panel p-4 max-h-48 overflow-y-auto shadow-2xl pointer-events-auto mx-4 mb-2 rounded-[1.5rem] border border-white/40
             transition-all duration-300 ease-out origin-bottom absolute bottom-[calc(100%+8px)] left-0 right-0
             ${globalWinners.length > 0 && !isLotteryRunning && isMobileResultsOpen 
                ? 'opacity-100 scale-100 translate-y-0' 
                : 'opacity-0 scale-95 translate-y-4 pointer-events-none'}
         `}>
              <div className="flex items-center justify-between mb-3">
                 <h3 className="font-bold text-gray-700 text-xs flex items-center gap-2">
                   <CheckCircle2 size={14} className="text-wechat" /> 中奖名单 ({globalWinners.length})
                 </h3>
                 <button onClick={() => setIsMobileResultsOpen(false)} className="text-xs text-gray-500 bg-gray-100/50 px-3 py-1.5 rounded-full font-bold active:scale-95 transition-transform">收起</button>
              </div>
              <div className="flex flex-wrap gap-2">
                 {globalWinners.map((w, i) => (
                   <div key={i} className="bg-white/80 border border-wechat/20 text-wechat-dark px-3 py-1.5 rounded-xl shadow-sm text-xs font-bold">
                     图{w.imageIndex} #{w.cellIndex + 1}
                   </div>
                 ))}
              </div>
           </div>

        <div className="glass-panel rounded-t-[2rem] border-b-0 px-6 py-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] flex items-center justify-between shadow-[0_-10px_40px_rgba(0,0,0,0.1)] pointer-events-auto bg-white/70 backdrop-blur-3xl">
           <div className="flex gap-6">
              <button 
                onClick={() => { setIsMobileSettingsOpen(true); setMobileTab('images'); }}
                className="flex flex-col items-center text-gray-400 hover:text-wechat px-1 transition-all duration-300 group active:scale-90"
              >
                <div className="p-1 rounded-xl group-hover:bg-wechat/10 transition-colors mb-0.5">
                   <ImageIcon size={24} strokeWidth={2} />
                </div>
                <span className="text-[10px] font-bold">图片</span>
              </button>
              <button 
                onClick={() => { setIsMobileSettingsOpen(true); setMobileTab('settings'); }}
                className="flex flex-col items-center text-gray-400 hover:text-wechat px-1 transition-all duration-300 group active:scale-90"
              >
                 <div className="p-1 rounded-xl group-hover:bg-wechat/10 transition-colors mb-0.5">
                    <Settings2 size={24} strokeWidth={2} />
                 </div>
                <span className="text-[10px] font-bold">设置</span>
              </button>
              <button 
                onClick={() => { setIsMobileSettingsOpen(true); setMobileTab('history'); }}
                className="flex flex-col items-center text-gray-400 hover:text-wechat px-1 transition-all duration-300 group active:scale-90"
              >
                 <div className="p-1 rounded-xl group-hover:bg-wechat/10 transition-colors mb-0.5">
                   <History size={24} strokeWidth={2} />
                 </div>
                <span className="text-[10px] font-bold">记录</span>
              </button>
              {globalWinners.length > 0 && (
                <button 
                  onClick={() => setIsMobileResultsOpen(!isMobileResultsOpen)}
                  className={`flex flex-col items-center px-1 transition-all duration-300 group active:scale-90 ${isMobileResultsOpen ? 'text-wechat' : 'text-gray-400 hover:text-wechat'}`}
                >
                  <div className="p-1 rounded-xl group-hover:bg-wechat/10 transition-colors mb-0.5">
                     <Trophy size={24} strokeWidth={2} />
                  </div>
                  <span className="text-[10px] font-bold">结果</span>
                </button>
              )}
           </div>

           <button 
             onClick={startLottery} 
             disabled={isLotteryRunning || totalEligibleCount === 0}
             className={`px-7 py-3 rounded-full font-black text-white text-sm flex items-center gap-2 shadow-lg active:scale-95 transition-all duration-300
               ${isLotteryRunning ? 'bg-gray-400 shadow-none' : 'bg-gradient-to-r from-wechat to-[#05a350] shadow-wechat/40'}`}
           >
              {isLotteryRunning ? '...' : <Play size={18} fill="currentColor" />} 
              {isLotteryRunning ? '抽奖' : '开始'}
           </button>
        </div>
      </div>

       {/* --- Mobile Drawer (Smooth Transition) --- */}
       <div className={`fixed inset-0 z-50 flex flex-col justify-end transition-all duration-500 ${isMobileSettingsOpen ? 'visible' : 'invisible'}`}>
           {/* Backdrop */}
           <div 
             className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-500 ${isMobileSettingsOpen ? 'opacity-100' : 'opacity-0'}`} 
             onClick={() => setIsMobileSettingsOpen(false)}
           ></div>
           
           {/* Drawer Content */}
           <div className={`
               bg-white/80 backdrop-blur-2xl rounded-t-[2.5rem] p-6 overflow-y-auto shadow-[0_-10px_60px_rgba(0,0,0,0.2)] relative max-h-[85vh] flex flex-col pb-[calc(2rem+env(safe-area-inset-bottom))] border-t border-white/50
               transition-transform duration-500 cubic-bezier(0.32, 0.72, 0, 1)
               ${isMobileSettingsOpen ? 'translate-y-0' : 'translate-y-full'}
           `}>
                <div className="w-14 h-1.5 bg-gray-300/60 rounded-full mx-auto mb-8 flex-shrink-0"></div>
                
                <div className="flex items-center gap-2 bg-gray-100/50 p-1 rounded-2xl mb-6 flex-shrink-0 shadow-inner">
                   {['images', 'settings', 'history'].map((tab) => (
                     <button 
                      key={tab}
                      onClick={() => setMobileTab(tab as any)}
                      className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 active:scale-95
                        ${mobileTab === tab ? 'bg-white text-wechat shadow-lg shadow-gray-200/50' : 'text-gray-400 hover:text-gray-600'}`}
                     >
                       {tab === 'images' ? '图片' : tab === 'settings' ? '设置' : '历史'}
                     </button>
                   ))}
                </div>

                <div className="flex-1 overflow-y-auto pb-4 custom-scrollbar">
                  {mobileTab === 'images' && <ImageList />}
                  {mobileTab === 'settings' && <SettingsPanel />}
                  {mobileTab === 'history' && <HistoryList />}
                </div>

                <button 
                  onClick={() => setIsMobileSettingsOpen(false)}
                  className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 bg-white/50 p-2 rounded-full transition-all duration-300 backdrop-blur-md active:scale-90"
                >
                  <ChevronDown size={22} />
                </button>
             </div>
        </div>

    </div>
  );
};

// --- Canvas Component ---

interface CanvasEditorProps {
  imageLayouts: ImageLayout[];
  activeImageId: string | null;
  onUpdate: (id: string, updates: Partial<LotteryImage>) => void;
  onSelectImage: (id: string) => void;
  onInteractionStart: (action: string) => void;
  scale: number;
  setScale: React.Dispatch<React.SetStateAction<number>>;
  pan: { x: number, y: number };
  setPan: React.Dispatch<React.SetStateAction<{ x: number, y: number }>>;
  setMode: (mode: InteractionMode) => void;
  isPanningMode: boolean;
  gridColor: string;
  tempFlasher: {imageId: string, cellIndex: number} | null;
  isLotteryRunning: boolean;
}

const CanvasEditor: React.FC<CanvasEditorProps> = ({ 
  imageLayouts,
  activeImageId,
  onUpdate,
  onSelectImage,
  onInteractionStart,
  scale, 
  setScale,
  pan, 
  setPan, 
  isPanningMode,
  gridColor,
  tempFlasher,
  isLotteryRunning 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  
  const [mode, setMode] = useState<InteractionMode>('none');
  const [activeHandle, setActiveHandle] = useState<ResizeHandle>(null);
  const [startPos, setStartPos] = useState<{ x: number, y: number }>({ x: 0, y: 0 });
  const [initialSelection, setInitialSelection] = useState<Selection | null>(null);
  const [initialPan, setInitialPan] = useState<{ x: number, y: number } | null>(null);

  const activePointers = useRef<Map<number, { x: number, y: number }>>(new Map());
  const pinchStartInfo = useRef<{
    dist: number;
    scale: number;
    pan: { x: number, y: number };
    worldPoint: { x: number, y: number };
  } | null>(null);

  const getWorldPos = (e: React.PointerEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const x = (screenX - pan.x) / scale;
    const y = (screenY - pan.y) / scale;
    return { x, y };
  };

  const getImageAtWorldPos = (wx: number, wy: number) => {
    return imageLayouts.find(l => 
      wx >= l.worldX && wx <= l.worldX + l.naturalWidth &&
      wy >= l.worldY && wy <= l.worldY + l.naturalHeight
    );
  };

  const isPointInSelection = (wx: number, wy: number, layout: ImageLayout) => {
    if (!layout.selection) return false;
    const lx = wx - layout.worldX;
    const ly = wy - layout.worldY;
    const { x, y, w, h } = layout.selection;
    return lx >= x && lx <= x + w && ly >= y && ly <= y + h;
  };

  const getHandle = (wx: number, wy: number, layout: ImageLayout): ResizeHandle => {
    if (!layout.selection) return null;
    const lx = wx - layout.worldX;
    const ly = wy - layout.worldY;
    const { x, y, w, h } = layout.selection;
    const r = HANDLE_SIZE / scale;

    if (Math.abs(lx - x) < r && Math.abs(ly - y) < r) return 'tl';
    if (Math.abs(lx - (x + w)) < r && Math.abs(ly - y) < r) return 'tr';
    if (Math.abs(lx - (x + w)) < r && Math.abs(ly - (y + h)) < r) return 'br';
    if (Math.abs(lx - x) < r && Math.abs(ly - (y + h)) < r) return 'bl';

    if (Math.abs(lx - (x + w/2)) < r && Math.abs(ly - y) < r) return 'tm';
    if (Math.abs(lx - (x + w)) < r && Math.abs(ly - (y + h/2)) < r) return 'mr';
    if (Math.abs(lx - (x + w/2)) < r && Math.abs(ly - (y + h)) < r) return 'bm';
    if (Math.abs(lx - x) < r && Math.abs(ly - (y + h/2)) < r) return 'ml';

    return null;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    imageLayouts.forEach(layout => {
      if (!imagesRef.current.has(layout.id)) {
        const img = new Image();
        img.src = layout.src;
        imagesRef.current.set(layout.id, img);
      }
    });

    const render = () => {
      const cw = containerRef.current!.clientWidth;
      const ch = containerRef.current!.clientHeight;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      ctx.clearRect(0, 0, cw, ch);

      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(scale, scale);

      imageLayouts.forEach(layout => {
        const imgObj = imagesRef.current.get(layout.id);
        if (!imgObj) return;

        ctx.save();
        ctx.translate(layout.worldX, layout.worldY);

        ctx.drawImage(imgObj, 0, 0);

        if (layout.id === activeImageId) {
           ctx.shadowColor = 'rgba(7, 193, 96, 0.5)';
           ctx.shadowBlur = 20;
           ctx.shadowOffsetX = 0;
           ctx.shadowOffsetY = 0;
           ctx.lineWidth = 4 / scale;
           ctx.strokeStyle = '#07C160';
           ctx.strokeRect(0, 0, layout.naturalWidth, layout.naturalHeight);
           ctx.shadowBlur = 0; 
        }

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        if (layout.selection) {
          const { x, y, w, h } = layout.selection;
          
          ctx.beginPath();
          ctx.rect(0, 0, layout.naturalWidth, layout.naturalHeight);
          ctx.moveTo(x, y);
          ctx.lineTo(x, y+h);
          ctx.lineTo(x+w, y+h);
          ctx.lineTo(x+w, y);
          ctx.lineTo(x, y);
          ctx.fill('evenodd');

          const cellW = w / layout.gridCols;
          const cellH = h / layout.gridRows;
          
          ctx.beginPath();
          ctx.strokeStyle = gridColor;
          ctx.lineWidth = 1 / scale; 

          for(let i=1; i<layout.gridCols; i++) {
            ctx.moveTo(x + i*cellW, y);
            ctx.lineTo(x + i*cellW, y + h);
          }
          for(let i=1; i<layout.gridRows; i++) {
            ctx.moveTo(x, y + i*cellH);
            ctx.lineTo(x + w, y + i*cellH);
          }
          ctx.stroke();

          layout.excludedCells.forEach(idx => {
            const r = Math.floor(idx / layout.gridCols);
            const c = idx % layout.gridCols;
            const cx = x + c * cellW;
            const cy = y + r * cellH;

            ctx.fillStyle = 'rgba(100, 100, 100, 0.7)';
            ctx.fillRect(cx, cy, cellW, cellH);
            
            ctx.beginPath();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2 / scale;
            ctx.moveTo(cx + cellW*0.2, cy + cellH*0.2);
            ctx.lineTo(cx + cellW*0.8, cy + cellH*0.8);
            ctx.moveTo(cx + cellW*0.8, cy + cellH*0.2);
            ctx.lineTo(cx + cellW*0.2, cy + cellH*0.8);
            ctx.stroke();
          });

          const minDim = Math.min(cellW, cellH);
          const borderThickness = Math.max(3, minDim * 0.08); 
          const fontSize = Math.max(14, minDim * 0.4); 

          if (tempFlasher && tempFlasher.imageId === layout.id) {
             const idx = tempFlasher.cellIndex;
             const r = Math.floor(idx / layout.gridCols);
             const c = idx % layout.gridCols;
             const cx = x + c * cellW;
             const cy = y + r * cellH;

             ctx.strokeStyle = '#ff0000';
             ctx.lineWidth = borderThickness;
             ctx.strokeRect(cx + borderThickness/2, cy + borderThickness/2, cellW - borderThickness, cellH - borderThickness);
             ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
             ctx.fillRect(cx, cy, cellW, cellH);
          }

          layout.winners.forEach(idx => {
             const r = Math.floor(idx / layout.gridCols);
             const c = idx % layout.gridCols;
             const cx = x + c * cellW;
             const cy = y + r * cellH;

             ctx.strokeStyle = '#ff0000';
             ctx.lineWidth = borderThickness;
             ctx.strokeRect(cx + borderThickness/2, cy + borderThickness/2, cellW - borderThickness, cellH - borderThickness);
             
             ctx.fillStyle = '#ff0000';
             ctx.font = `bold ${fontSize}px Arial`;
             const text = `#${idx+1}`;
             const tm = ctx.measureText(text);
             ctx.fillText(text, cx + (cellW - tm.width)/2, cy + (cellH + fontSize*0.35)/2);
          });

          if (!isLotteryRunning && layout.id === activeImageId) {
             ctx.strokeStyle = '#07C160';
             ctx.lineWidth = 2 / scale;
             ctx.strokeRect(x, y, w, h);

             ctx.fillStyle = 'white';
             ctx.strokeStyle = '#07C160';
             ctx.lineWidth = 1 / scale;
             const handleSize = 8 / scale;

             const drawHandle = (hx: number, hy: number) => {
               ctx.beginPath();
               ctx.rect(hx - handleSize/2, hy - handleSize/2, handleSize, handleSize);
               ctx.fill();
               ctx.stroke();
             };

             drawHandle(x, y); 
             drawHandle(x + w/2, y); 
             drawHandle(x + w, y); 
             drawHandle(x + w, y + h/2); 
             drawHandle(x + w, y + h); 
             drawHandle(x + w/2, y + h); 
             drawHandle(x, y + h); 
             drawHandle(x, y + h/2); 
          }

        } else {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(0, 0, layout.naturalWidth, layout.naturalHeight);
        }

        ctx.restore();
      });

      ctx.restore();
    };

    let animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);

  }, [imageLayouts, activeImageId, scale, pan, gridColor, tempFlasher, isLotteryRunning]);


  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2) {
      const points = Array.from(activePointers.current.values());
      const p1 = points[0];
      const p2 = points[1];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const screenX = cx - rect.left;
        const screenY = cy - rect.top;
        const wx = (screenX - pan.x) / scale;
        const wy = (screenY - pan.y) / scale;

        pinchStartInfo.current = {
          dist,
          scale, 
          pan,   
          worldPoint: { x: wx, y: wy }
        };
      }
      return; 
    }

    if (isPanningMode || e.button === 1 || e.shiftKey) { 
      setMode('panning');
      setStartPos({ x: e.clientX, y: e.clientY });
      setInitialPan({ ...pan });
      return;
    }

    if (isLotteryRunning) return;

    const { x: wx, y: wy } = getWorldPos(e);
    setStartPos({ x: e.clientX, y: e.clientY }); 

    const activeLayout = imageLayouts.find(l => l.id === activeImageId);
    
    if (activeLayout && activeLayout.selection) {
       const handle = getHandle(wx, wy, activeLayout);
       if (handle) {
         setMode('resizing');
         setActiveHandle(handle);
         setInitialSelection({ ...activeLayout.selection });
         onInteractionStart('调整选区大小'); 
         return;
       }
       if (isPointInSelection(wx, wy, activeLayout)) {
         setMode('moving');
         setInitialSelection({ ...activeLayout.selection });
         onInteractionStart('移动选区'); 
         return;
       }
    }

    const clickedImage = getImageAtWorldPos(wx, wy);
    
    if (clickedImage) {
      if (clickedImage.id !== activeImageId) {
        onSelectImage(clickedImage.id);
      }
      
      setMode('drawing');
      onInteractionStart('创建选区'); 
      
      const lx = wx - clickedImage.worldX;
      const ly = wy - clickedImage.worldY;
      
      onUpdate(clickedImage.id, { 
        selection: { x: lx, y: ly, w: 0, h: 0 },
        excludedCells: [],
        winners: []
      });
    } else {
      setMode('panning');
      setStartPos({ x: e.clientX, y: e.clientY });
      setInitialPan({ ...pan });
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    e.preventDefault();
    
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2 && pinchStartInfo.current) {
      const points = Array.from(activePointers.current.values());
      const p1 = points[0];
      const p2 = points[1];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const scaleRatio = dist / pinchStartInfo.current.dist;
        let newScale = pinchStartInfo.current.scale * scaleRatio;
        newScale = Math.min(Math.max(newScale, 0.1), 5); 

        const screenX = cx - rect.left;
        const screenY = cy - rect.top;
        
        const newPanX = screenX - pinchStartInfo.current.worldPoint.x * newScale;
        const newPanY = screenY - pinchStartInfo.current.worldPoint.y * newScale;

        setScale(newScale);
        setPan({ x: newPanX, y: newPanY });
      }
      return; 
    }

    const { x: wx, y: wy } = getWorldPos(e);
    const activeLayout = imageLayouts.find(l => l.id === activeImageId);

    if (mode === 'none' && !isLotteryRunning && activeLayout && activeLayout.selection) {
       const handle = getHandle(wx, wy, activeLayout);
       const canvas = canvasRef.current;
       if (canvas) {
         if (handle) {
            const cursorMap: Record<string, string> = {
              tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize',
              tm: 'n-resize', bm: 's-resize', ml: 'w-resize', mr: 'e-resize'
            };
            canvas.style.cursor = cursorMap[handle];
         } else if (isPointInSelection(wx, wy, activeLayout)) {
            canvas.style.cursor = 'move';
         } else {
            canvas.style.cursor = 'crosshair';
         }
       }
    }

    if (mode === 'panning' && initialPan) {
      const dx = e.clientX - startPos.x;
      const dy = e.clientY - startPos.y;
      setPan({ x: initialPan.x + dx, y: initialPan.y + dy });
      return;
    }

    if (!activeLayout) return; 

    if (mode === 'drawing' && activeLayout.selection) {
      const lx = wx - activeLayout.worldX;
      const ly = wy - activeLayout.worldY;
      const w = lx - activeLayout.selection.x;
      const h = ly - activeLayout.selection.y;
      onUpdate(activeLayout.id, { selection: { ...activeLayout.selection, w, h } });
    } 
    
    else if (mode === 'moving' && initialSelection) {
       const dx = (e.clientX - startPos.x) / scale;
       const dy = (e.clientY - startPos.y) / scale;
       
       let newX = initialSelection.x + dx;
       let newY = initialSelection.y + dy;
       
       newX = Math.max(0, Math.min(newX, activeLayout.naturalWidth - initialSelection.w));
       newY = Math.max(0, Math.min(newY, activeLayout.naturalHeight - initialSelection.h));

       if (activeLayout.excludedCells.length > 0) {
          onUpdate(activeLayout.id, { excludedCells: [], winners: [] });
       }
       onUpdate(activeLayout.id, { selection: { ...initialSelection, x: newX, y: newY } });
    }

    else if (mode === 'resizing' && initialSelection && activeHandle) {
       if (activeLayout.excludedCells.length > 0) {
          onUpdate(activeLayout.id, { excludedCells: [], winners: [] });
       }

       const s = initialSelection;
       const dx = (e.clientX - startPos.x) / scale;
       const dy = (e.clientY - startPos.y) / scale;
       let newX = s.x, newY = s.y, newW = s.w, newH = s.h;

       if (activeHandle.includes('l')) { newX += dx; newW -= dx; }
       if (activeHandle.includes('r')) { newW += dx; }
       if (activeHandle.includes('t')) { newY += dy; newH -= dy; }
       if (activeHandle.includes('b')) { newH += dy; }

       if (newW < 0) { newX += newW; newW = Math.abs(newW); }
       if (newH < 0) { newY += newH; newH = Math.abs(newH); }

       onUpdate(activeLayout.id, { selection: { x: newX, y: newY, w: newW, h: newH } });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    
    activePointers.current.delete(e.pointerId);

    // Fix for jumping: If we were pinching (2 fingers) and lifted one,
    // we must re-anchor the startPos for the remaining finger to current coordinates
    // so that subsequent single-finger moves don't apply a stale large delta.
    if (activePointers.current.size === 1 && pinchStartInfo.current) {
       const remaining = activePointers.current.values().next().value;
       if (remaining) {
         setStartPos({ x: remaining.x, y: remaining.y });
         setInitialPan({ ...pan });
         // Ensure we continue smoothly in panning mode
         setMode('panning');
       }
    }

    if (activePointers.current.size < 2) {
      pinchStartInfo.current = null;
    }
    
    if (activePointers.current.size > 0) {
      return; 
    }

    const activeLayout = imageLayouts.find(l => l.id === activeImageId);
    
    if (activeLayout && activeLayout.selection) {
       const { x, y, w, h } = activeLayout.selection;
       const normSel = {
        x: w < 0 ? x + w : x,
        y: h < 0 ? y + h : y,
        w: Math.abs(w),
        h: Math.abs(h)
      };

      if (mode === 'drawing' && (normSel.w < 10 || normSel.h < 10)) {
         onUpdate(activeLayout.id, { selection: null });
      } else if (mode !== 'none' && mode !== 'panning') {
         onUpdate(activeLayout.id, { selection: normSel });
      }

      if (mode === 'moving') {
         const dist = Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y);
         if (dist < DRAG_THRESHOLD) {
            handleCellClick(e, activeLayout);
         }
      }
    }

    setMode('none');
    setActiveHandle(null);
    setInitialSelection(null);
    setInitialPan(null);
  };

  const handleCellClick = (e: React.PointerEvent, layout: ImageLayout) => {
    if (!layout.selection) return;
    const { x, y } = getWorldPos(e);
    const lx = x - layout.worldX;
    const ly = y - layout.worldY;
    
    const rx = lx - layout.selection.x;
    const ry = ly - layout.selection.y;
    
    const cellW = layout.selection.w / layout.gridCols;
    const cellH = layout.selection.h / layout.gridRows;
    
    const col = Math.floor(rx / cellW);
    const row = Math.floor(ry / cellH);

    if (col >= 0 && col < layout.gridCols && row >= 0 && row < layout.gridRows) {
       onInteractionStart('排除/恢复格子'); 
       const idx = row * layout.gridCols + col;
       const isExcluded = layout.excludedCells.includes(idx);
       const newExcluded = isExcluded 
         ? layout.excludedCells.filter(i => i !== idx)
         : [...layout.excludedCells, idx];
       onUpdate(layout.id, { excludedCells: newExcluded });
    }
  };

  return (
    <div 
      ref={containerRef} 
      className={`w-full h-full bg-transparent select-none ${isPanningMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
        <canvas
          ref={canvasRef}
          className="block w-full h-full"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
    </div>
  );
};

export default App;
