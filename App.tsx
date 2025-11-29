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
  FileJson
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
  
  // History State
  const [history, setHistory] = useState<LotteryImage[][]>([]);
  const [future, setFuture] = useState<LotteryImage[][]>([]);
  
  // Canvas View State
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanningMode, setIsPanningMode] = useState(false);

  // Mobile UI State
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const [isMobileResultsOpen, setIsMobileResultsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'images' | 'settings'>('settings');

  // Computed
  const activeImage = useMemo(() => images.find(img => img.id === activeImageId), [images, activeImageId]);
  
  const { layouts: imageLayouts } = useMemo(() => getImagesLayout(images), [images]);

  const totalEligibleCount = useMemo(() => {
    return images.reduce((acc, img) => {
      if (!img.selection) return acc;
      const totalCells = img.gridRows * img.gridCols;
      return acc + (totalCells - img.excludedCells.length);
    }, 0);
  }, [images]);

  // --- History Actions ---
  const saveHistory = useCallback(() => {
    setHistory(prev => {
      const newHistory = [...prev, images];
      // Limit history size to 50 to prevent memory issues
      if (newHistory.length > 50) return newHistory.slice(newHistory.length - 50);
      return newHistory;
    });
    setFuture([]);
  }, [images]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    
    setFuture(prev => [images, ...prev]);
    setImages(previous);
    setHistory(newHistory);
  }, [history, images]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);

    setHistory(prev => [...prev, images]);
    setImages(next);
    setFuture(newFuture);
  }, [future, images]);

  // Keyboard Shortcuts for Undo/Redo
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

    // Get container size
    const containerW = window.innerWidth; 
    const containerH = window.innerHeight; 

    // Mobile adjustment
    const isMobile = window.innerWidth < 768;
    const viewW = isMobile ? containerW : containerW - 320; // Subtract sidebar width on desktop
    const viewH = isMobile ? containerH - 64 : containerH; // Subtract bottom bar on mobile

    const padding = 40;
    const fitScale = Math.min(
      (viewW - padding * 2) / layout.naturalWidth, 
      (viewH - padding * 2) / layout.naturalHeight
    );
    
    // Clamp scale
    const finalScale = Math.min(Math.max(fitScale, 0.1), 2);

    // Center layout
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
      saveHistory(); // Save state before adding images
      const newImages: LotteryImage[] = [];
      let lastId = "";
      Array.from(e.target.files).forEach((file: File) => {
        const src = URL.createObjectURL(file);
        const img = new Image();
        img.src = src;
        img.onload = () => {
          setImages(prev => {
            const nextId = generateId();
            lastId = nextId;
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
      // Slight delay to allow state update before setting active
      setTimeout(() => {
        if (newImages.length > 0) setActiveImageId(newImages[0].id); 
      }, 100);
    }
  };

  const removeImage = (id: string) => {
    saveHistory(); // Save state before removing
    setImages(prev => {
      const next = prev.filter(img => img.id !== id);
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
      // Convert images to base64
      const imagesExportData = await Promise.all(images.map(async (img) => {
        // We need to fetch the blob from the object URL to convert to base64
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

        saveHistory(); // Save current state before overwriting

        // Restore settings
        setWinnerCount(config.settings.winnerCount);
        setAnimationDuration(config.settings.animationDuration);
        setGridColor(config.settings.gridColor);

        // Restore images (Convert Base64 back to Blob URL for performance)
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
            winners: [] // Don't restore winners
          };
        }));

        setImages(restoredImages);
        if (restoredImages.length > 0) {
          setActiveImageId(restoredImages[0].id);
          // Optional: Zoom to first image after import
          // setTimeout(() => zoomToImage(restoredImages[0].id), 100); 
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
    e.target.value = ''; // Reset input
  };


  // Effect: Auto-zoom to first image on load if it's the only one
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
    
    saveHistory(); // Save state before clearing previous winners

    // Close mobile drawer if open
    setIsMobileSettingsOpen(false);
    setIsMobileResultsOpen(false);

    // Clear previous winners
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
        setIsMobileResultsOpen(true); // Open results on mobile when done
      }
    };

    requestAnimationFrame(animate);

  }, [images, totalEligibleCount, winnerCount, animationDuration, saveHistory]);


  // --- Render Parts ---

  const ImageList = () => (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
      {images.map((img, idx) => (
        <div 
          key={img.id}
          onClick={() => handleSelectImage(img.id)}
          className={`relative flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${activeImageId === img.id ? 'border-wechat ring-2 ring-wechat/20' : 'border-transparent hover:border-gray-300'}`}
        >
          <img src={img.src} alt="" className="w-full h-full object-cover" />
          <button 
            onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
            className="absolute top-0 right-0 bg-red-500 text-white p-1 rounded-bl hover:bg-red-600 z-10"
          >
            <X size={12} />
          </button>
          <div className="absolute bottom-0 left-0 bg-black/50 text-white text-[10px] px-1 w-full text-center truncate">
            图 {idx + 1}
          </div>
        </div>
      ))}
      
      <label className="flex-shrink-0 w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:border-wechat hover:bg-wechat-light transition-colors text-gray-400 hover:text-wechat">
        <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
        <Plus size={24} />
        <span className="text-[10px] mt-1">添加图片</span>
      </label>
    </div>
  );

  const SettingsPanel = () => (
    <div className="space-y-6">
       {/* Active Image Settings */}
       <section className={`transition-opacity ${!activeImage ? 'opacity-50 pointer-events-none' : ''}`}>
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Grid3X3 size={14} /> 当前图片网格设置
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
                onChange={(e) => {
                  saveHistory();
                  updateActiveImage({ gridRows: Math.max(1, parseInt(e.target.value) || 1), excludedCells: [], winners: [] });
                }}
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
                onChange={(e) => {
                  saveHistory();
                  updateActiveImage({ gridCols: Math.max(1, parseInt(e.target.value) || 1), excludedCells: [], winners: [] });
                }}
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

      {/* Global Lottery Settings */}
      <section className="pt-4 border-t border-gray-100">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Settings2 size={14} /> 抽奖全局设置
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
            
            {/* Export/Import Controls */}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button 
                onClick={handleExportConfig}
                className="flex items-center justify-center gap-2 px-3 py-2 border border-gray-200 rounded text-xs text-gray-600 hover:bg-gray-50 hover:text-wechat transition-colors"
                title="导出当前配置（含图片）到 JSON 文件"
              >
                <Download size={14} /> 导出配置
              </button>
              <label className="flex items-center justify-center gap-2 px-3 py-2 border border-gray-200 rounded text-xs text-gray-600 hover:bg-gray-50 hover:text-wechat transition-colors cursor-pointer">
                <FileJson size={14} /> 导入配置
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
    <div className="flex flex-col md:flex-row h-screen w-full bg-gray-100 overflow-hidden font-sans text-gray-800">
      <style>
        {`
          .no-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
        `}
      </style>
      
      {/* Canvas Area (Fullscreen on Mobile, Left side on Desktop) */}
      <div className="absolute inset-0 md:relative md:flex-1 bg-gray-200 overflow-hidden flex flex-col z-0">
        {/* Floating Toolbar (Top) */}
        <div className="
          z-20 flex gap-2 items-center pointer-events-auto
          fixed top-0 left-0 right-0 bg-white/90 backdrop-blur border-b border-gray-200 px-4 py-3 overflow-x-auto no-scrollbar
          md:absolute md:top-4 md:left-1/2 md:-translate-x-1/2 md:w-auto md:bg-white/90 md:rounded-full md:shadow-lg md:border md:justify-center md:border-gray-200 md:py-2
        ">
           {/* Undo/Redo Buttons */}
           <button 
             onClick={undo}
             disabled={history.length === 0 || isLotteryRunning}
             className={`p-2 rounded-full transition-colors flex-shrink-0 ${history.length === 0 || isLotteryRunning ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100 text-gray-600'}`}
             title="撤销 (Ctrl+Z)"
           >
             <Undo2 size={18} />
           </button>
           <button 
             onClick={redo}
             disabled={future.length === 0 || isLotteryRunning}
             className={`p-2 rounded-full transition-colors flex-shrink-0 ${future.length === 0 || isLotteryRunning ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100 text-gray-600'}`}
             title="重做 (Ctrl+Shift+Z)"
           >
             <Redo2 size={18} />
           </button>
           <div className="w-px h-6 bg-gray-300 mx-1 flex-shrink-0"></div>

           <button 
            onClick={() => setIsPanningMode(false)}
            className={`p-2 rounded-full transition-colors flex-shrink-0 ${!isPanningMode ? 'bg-wechat text-white' : 'hover:bg-gray-100 text-gray-600'}`}
            title="选择模式"
          >
            <MousePointer2 size={18} />
          </button>
          <button 
            onClick={() => setIsPanningMode(true)}
            className={`p-2 rounded-full transition-colors flex-shrink-0 ${isPanningMode ? 'bg-wechat text-white' : 'hover:bg-gray-100 text-gray-600'}`}
            title="移动视图 (空格键按住)"
          >
            <Move size={18} />
          </button>
          <div className="w-px h-6 bg-gray-300 mx-1 flex-shrink-0"></div>
          <button onClick={() => setScale(s => Math.min(s + 0.05, 5))} className="p-2 hover:bg-gray-100 rounded-full text-gray-600 flex-shrink-0">
            <ZoomIn size={18} />
          </button>
          <span className="text-xs font-medium w-12 text-center flex-shrink-0">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.max(s - 0.05, 0.2))} className="p-2 hover:bg-gray-100 rounded-full text-gray-600 flex-shrink-0">
            <ZoomOut size={18} />
          </button>
           <button onClick={() => { if(activeImageId) zoomToImage(activeImageId); else { setScale(1); setPan({x:0, y:0}); } }} className="ml-2 text-xs text-wechat font-medium hover:underline flex-shrink-0 whitespace-nowrap">
            重置
          </button>
        </div>

        {/* Infinite Canvas */}
        <div className="flex-1 relative overflow-hidden cursor-crosshair touch-none" id="canvas-container">
             {images.length === 0 ? (
               <div className="flex items-center justify-center h-full flex-col text-gray-400 p-8 text-center pointer-events-none">
                 <ImageIcon size={64} className="mb-4 opacity-50" />
                 <p className="text-lg font-medium">还没有图片</p>
                 <p className="text-sm mt-2">点击右侧(桌面)或下方(手机)添加图片</p>
               </div>
             ) : (
               <CanvasEditor 
                  imageLayouts={imageLayouts}
                  activeImageId={activeImageId}
                  onUpdate={(id, updates) => {
                    setImages(prev => prev.map(img => img.id === id ? { ...img, ...updates } : img));
                  }}
                  onSelectImage={handleSelectImage}
                  onInteractionStart={saveHistory}
                  scale={scale}
                  setScale={setScale} // Pass setScale for pinch zoom
                  pan={pan}
                  setPan={setPan}
                  isPanningMode={isPanningMode}
                  gridColor={gridColor}
                  tempFlasher={tempFlasher}
                  isLotteryRunning={isLotteryRunning}
               />
             )}
        </div>
      </div>

      {/* --- Desktop Sidebar --- */}
      <div className="hidden md:flex w-80 bg-white border-l border-gray-200 flex-col z-10 shadow-xl relative h-full">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
          <h1 className="font-bold text-lg text-gray-800 flex items-center justify-between w-full">
             <span className="flex items-center gap-2"><Trophy className="text-wechat" size={20} /> 抽奖助手</span>
             <span className="text-xs bg-wechat-light text-wechat-dark px-2 py-1 rounded font-medium">Pro</span>
          </h1>
        </div>

        {/* Scrollable Middle Content */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
           <section className="mb-6">
             <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">图片列表</h2>
             <ImageList />
           </section>

           <SettingsPanel />
        </div>

        {/* Fixed Bottom: Draw & Results */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
           <button 
            onClick={startLottery}
            disabled={isLotteryRunning || totalEligibleCount === 0}
            className={`w-full py-3 rounded-lg flex items-center justify-center gap-2 font-bold text-white transition-all transform active:scale-95 shadow-md mb-4
              ${isLotteryRunning || totalEligibleCount === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-wechat hover:bg-wechat-dark shadow-wechat/30'}`}
           >
             {isLotteryRunning ? '抽奖中...' : <><Play size={20} fill="currentColor" /> 开始抽奖</>}
           </button>

           {/* Desktop Results - Horizontal Scroll, max 5 rows */}
           {globalWinners.length > 0 && !isLotteryRunning && (
             <div className="animate-fade-in-up">
               <h3 className="font-bold text-gray-700 mb-2 flex items-center gap-2 text-sm">
                 <CheckCircle2 size={16} className="text-wechat" /> 中奖名单 ({globalWinners.length})
               </h3>
               <div 
                  className="grid grid-rows-5 grid-flow-col gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-300"
                  style={{ maxHeight: '180px' }} // Approx 5 rows height
                >
                 {globalWinners.map((w, i) => (
                   <div 
                    key={i} 
                    className="w-24 flex-shrink-0 bg-white border border-wechat/50 text-wechat px-2 py-1.5 rounded shadow-sm text-xs font-medium text-center whitespace-nowrap hover:bg-wechat-light cursor-default"
                    title={`图${w.imageIndex} - 格子 #${w.cellIndex + 1}`}
                   >
                     图{w.imageIndex} - #{w.cellIndex + 1}
                   </div>
                 ))}
               </div>
             </div>
           )}
        </div>
      </div>

      {/* --- Mobile Bottom Bar --- */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex flex-col justify-end pointer-events-none">
        {/* Results Overlay (Mobile) - Toggleable */}
        {globalWinners.length > 0 && !isLotteryRunning && isMobileResultsOpen && (
           <div className="bg-white/95 backdrop-blur border-t border-gray-200 p-3 max-h-40 overflow-y-auto animate-slide-up shadow-sm pointer-events-auto">
              <div className="flex items-center justify-between mb-2">
                 <h3 className="font-bold text-gray-700 text-xs flex items-center gap-2">
                   <CheckCircle2 size={14} className="text-wechat" /> 中奖名单 ({globalWinners.length})
                 </h3>
                 <button onClick={() => setIsMobileResultsOpen(false)} className="text-xs text-gray-400">收起</button>
              </div>
              <div className="flex flex-wrap gap-2">
                 {globalWinners.map((w, i) => (
                   <div key={i} className="bg-white border border-wechat text-wechat px-2 py-0.5 rounded shadow-sm text-xs">
                     图{w.imageIndex} #{w.cellIndex + 1}
                   </div>
                 ))}
              </div>
           </div>
        )}

        {/* Mobile Control Bar */}
        <div className="bg-white border-t border-gray-200 px-4 py-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] flex items-center justify-between shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] pointer-events-auto">
           <div className="flex gap-5">
              <button 
                onClick={() => { setIsMobileSettingsOpen(true); setMobileTab('images'); }}
                className="flex flex-col items-center text-gray-500 hover:text-wechat"
              >
                <ImageIcon size={20} />
                <span className="text-[10px]">图片</span>
              </button>
              <button 
                onClick={() => { setIsMobileSettingsOpen(true); setMobileTab('settings'); }}
                className="flex flex-col items-center text-gray-500 hover:text-wechat"
              >
                <Settings2 size={20} />
                <span className="text-[10px]">设置</span>
              </button>
              {globalWinners.length > 0 && (
                <button 
                  onClick={() => setIsMobileResultsOpen(!isMobileResultsOpen)}
                  className={`flex flex-col items-center ${isMobileResultsOpen ? 'text-wechat' : 'text-gray-500 hover:text-wechat'}`}
                >
                  <Trophy size={20} />
                  <span className="text-[10px]">结果</span>
                </button>
              )}
           </div>

           <button 
             onClick={startLottery} 
             disabled={isLotteryRunning || totalEligibleCount === 0}
             className={`px-6 py-2 rounded-full font-bold text-white text-sm flex items-center gap-2 shadow-md shadow-wechat/20
               ${isLotteryRunning ? 'bg-gray-400' : 'bg-wechat'}`}
           >
              {isLotteryRunning ? '...' : <Play size={16} fill="currentColor" />} 
              {isLotteryRunning ? '抽奖中' : '开始'}
           </button>
        </div>
      </div>

       {/* --- Mobile Drawer (Full Screen Backdrop) --- */}
       {isMobileSettingsOpen && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end">
             {/* Backdrop */}
             <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsMobileSettingsOpen(false)}></div>
             
             {/* Drawer Content */}
             <div className="bg-white rounded-t-2xl p-4 overflow-y-auto animate-slide-up shadow-2xl relative max-h-[85vh] flex flex-col">
                <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-4 flex-shrink-0"></div>
                
                <div className="flex items-center gap-4 border-b border-gray-100 mb-4 flex-shrink-0">
                   <button 
                    onClick={() => setMobileTab('images')}
                    className={`pb-2 text-sm font-bold ${mobileTab === 'images' ? 'text-wechat border-b-2 border-wechat' : 'text-gray-400'}`}
                   >
                     图片列表
                   </button>
                   <button 
                    onClick={() => setMobileTab('settings')}
                    className={`pb-2 text-sm font-bold ${mobileTab === 'settings' ? 'text-wechat border-b-2 border-wechat' : 'text-gray-400'}`}
                   >
                     抽奖设置
                   </button>
                </div>

                <div className="flex-1 overflow-y-auto pb-4">
                  {mobileTab === 'images' ? <ImageList /> : <SettingsPanel />}
                </div>

                <button 
                  onClick={() => setIsMobileSettingsOpen(false)}
                  className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
                >
                  <ChevronDown size={24} />
                </button>
             </div>
          </div>
        )}

    </div>
  );
};

// --- Canvas Component ---

interface CanvasEditorProps {
  imageLayouts: ImageLayout[];
  activeImageId: string | null;
  onUpdate: (id: string, updates: Partial<LotteryImage>) => void;
  onSelectImage: (id: string) => void;
  onInteractionStart: () => void;
  scale: number;
  setScale: React.Dispatch<React.SetStateAction<number>>; // Added for pinch zoom
  pan: { x: number, y: number };
  setPan: React.Dispatch<React.SetStateAction<{ x: number, y: number }>>;
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
  
  // Interaction State
  const [mode, setMode] = useState<InteractionMode>('none');
  const [activeHandle, setActiveHandle] = useState<ResizeHandle>(null);
  const [startPos, setStartPos] = useState<{ x: number, y: number }>({ x: 0, y: 0 });
  const [initialSelection, setInitialSelection] = useState<Selection | null>(null);
  const [initialPan, setInitialPan] = useState<{ x: number, y: number } | null>(null);

  // Multi-touch / Pinch State
  const activePointers = useRef<Map<number, { x: number, y: number }>>(new Map());
  const pinchStartInfo = useRef<{
    dist: number;
    scale: number;
    pan: { x: number, y: number };
    worldPoint: { x: number, y: number };
  } | null>(null);


  // Helper: Get world coordinates from pointer event
  const getWorldPos = (e: React.PointerEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const x = (screenX - pan.x) / scale;
    const y = (screenY - pan.y) / scale;
    return { x, y };
  };

  // Helper: Find which image is at world coordinates
  const getImageAtWorldPos = (wx: number, wy: number) => {
    return imageLayouts.find(l => 
      wx >= l.worldX && wx <= l.worldX + l.naturalWidth &&
      wy >= l.worldY && wy <= l.worldY + l.naturalHeight
    );
  };

  // Helper: Check if point is inside a specific image's selection
  const isPointInSelection = (wx: number, wy: number, layout: ImageLayout) => {
    if (!layout.selection) return false;
    // Selection is relative to image, so convert world pos to local image pos
    const lx = wx - layout.worldX;
    const ly = wy - layout.worldY;
    const { x, y, w, h } = layout.selection;
    return lx >= x && lx <= x + w && ly >= y && ly <= y + h;
  };

  // Helper: Get resize handle for a specific image
  const getHandle = (wx: number, wy: number, layout: ImageLayout): ResizeHandle => {
    if (!layout.selection) return null;
    const lx = wx - layout.worldX;
    const ly = wy - layout.worldY;
    const { x, y, w, h } = layout.selection;
    const r = HANDLE_SIZE / scale;

    // Check corners
    if (Math.abs(lx - x) < r && Math.abs(ly - y) < r) return 'tl';
    if (Math.abs(lx - (x + w)) < r && Math.abs(ly - y) < r) return 'tr';
    if (Math.abs(lx - (x + w)) < r && Math.abs(ly - (y + h)) < r) return 'br';
    if (Math.abs(lx - x) < r && Math.abs(ly - (y + h)) < r) return 'bl';

    // Check edges
    if (Math.abs(lx - (x + w/2)) < r && Math.abs(ly - y) < r) return 'tm';
    if (Math.abs(lx - (x + w)) < r && Math.abs(ly - (y + h/2)) < r) return 'mr';
    if (Math.abs(lx - (x + w/2)) < r && Math.abs(ly - (y + h)) < r) return 'bm';
    if (Math.abs(lx - x) < r && Math.abs(ly - (y + h/2)) < r) return 'ml';

    return null;
  };

  // --- Drawing Logic ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Preload images into map
    imageLayouts.forEach(layout => {
      if (!imagesRef.current.has(layout.id)) {
        const img = new Image();
        img.src = layout.src;
        imagesRef.current.set(layout.id, img);
      }
    });

    const render = () => {
      // 1. Setup Canvas (Infinite)
      const cw = containerRef.current!.clientWidth;
      const ch = containerRef.current!.clientHeight;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      ctx.clearRect(0, 0, cw, ch);

      ctx.save();
      // Apply View Transform
      ctx.translate(pan.x, pan.y);
      ctx.scale(scale, scale);

      // 2. Draw Each Image
      imageLayouts.forEach(layout => {
        const imgObj = imagesRef.current.get(layout.id);
        if (!imgObj) return;

        // Save context for local image transform
        ctx.save();
        ctx.translate(layout.worldX, layout.worldY);

        // Draw Image
        ctx.drawImage(imgObj, 0, 0);

        // Draw Active Highlight (if this is the active image)
        if (layout.id === activeImageId) {
           ctx.shadowColor = 'rgba(7, 193, 96, 0.5)';
           ctx.shadowBlur = 20;
           ctx.shadowOffsetX = 0;
           ctx.shadowOffsetY = 0;
           ctx.lineWidth = 4 / scale;
           ctx.strokeStyle = '#07C160';
           ctx.strokeRect(0, 0, layout.naturalWidth, layout.naturalHeight);
           ctx.shadowBlur = 0; // Reset
        }

        // Draw Overlay (Dark mask outside selection)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        if (layout.selection) {
          const { x, y, w, h } = layout.selection;
          
          ctx.beginPath();
          ctx.rect(0, 0, layout.naturalWidth, layout.naturalHeight);
          // Cut hole
          ctx.moveTo(x, y);
          ctx.lineTo(x, y+h);
          ctx.lineTo(x+w, y+h);
          ctx.lineTo(x+w, y);
          ctx.lineTo(x, y);
          ctx.fill('evenodd');

          // Draw Grid
          const cellW = w / layout.gridCols;
          const cellH = h / layout.gridRows;
          
          ctx.beginPath();
          ctx.strokeStyle = gridColor;
          ctx.lineWidth = 1 / scale; // Keep thin

          for(let i=1; i<layout.gridCols; i++) {
            ctx.moveTo(x + i*cellW, y);
            ctx.lineTo(x + i*cellW, y + h);
          }
          for(let i=1; i<layout.gridRows; i++) {
            ctx.moveTo(x, y + i*cellH);
            ctx.lineTo(x + w, y + i*cellH);
          }
          ctx.stroke();

          // Draw Excluded Cells
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

          // Draw Winners & Flasher Logic
          // Calculate dynamic styles based on CELL SIZE (in world units) to ensure consistency with zoom
          const minDim = Math.min(cellW, cellH);
          const borderThickness = Math.max(3, minDim * 0.08); // Approx 8% of cell size
          const fontSize = Math.max(14, minDim * 0.4); // Approx 40% of cell size

          // Draw Flasher (Global logic passes single flasher)
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

          // Draw Winners
          layout.winners.forEach(idx => {
             const r = Math.floor(idx / layout.gridCols);
             const c = idx % layout.gridCols;
             const cx = x + c * cellW;
             const cy = y + r * cellH;

             ctx.strokeStyle = '#ff0000';
             ctx.lineWidth = borderThickness;
             // Inset to stay within cell
             ctx.strokeRect(cx + borderThickness/2, cy + borderThickness/2, cellW - borderThickness, cellH - borderThickness);
             
             // Label
             ctx.fillStyle = '#ff0000';
             ctx.font = `bold ${fontSize}px Arial`;
             const text = `#${idx+1}`;
             const tm = ctx.measureText(text);
             // Center text in cell
             ctx.fillText(text, cx + (cellW - tm.width)/2, cy + (cellH + fontSize*0.35)/2);
          });

          // Selection Border & Handles
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
          // No selection - mask whole image
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(0, 0, layout.naturalWidth, layout.naturalHeight);
        }

        ctx.restore(); // End local image transform
      });

      ctx.restore(); // End view transform
    };

    let animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);

  }, [imageLayouts, activeImageId, scale, pan, gridColor, tempFlasher, isLotteryRunning]);


  // --- Event Listeners ---

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    
    // Add pointer for multi-touch
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Multi-touch Pinch Check
    if (activePointers.current.size === 2) {
      const points = Array.from(activePointers.current.values());
      const p1 = points[0];
      const p2 = points[1];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;

      // Calculate the point in World Space that is currently under the center of the pinch
      // Screen = World * Scale + Pan  =>  World = (Screen - Pan) / Scale
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const screenX = cx - rect.left;
        const screenY = cy - rect.top;
        const wx = (screenX - pan.x) / scale;
        const wy = (screenY - pan.y) / scale;

        pinchStartInfo.current = {
          dist,
          scale, // Capture current scale at start of pinch
          pan,   // Capture current pan at start of pinch
          worldPoint: { x: wx, y: wy }
        };
      }
      return; // Stop processing other interactions
    }

    // Pan Mode
    if (isPanningMode || e.button === 1 || e.shiftKey) { 
      setMode('panning');
      setStartPos({ x: e.clientX, y: e.clientY });
      setInitialPan({ ...pan });
      return;
    }

    if (isLotteryRunning) return;

    const { x: wx, y: wy } = getWorldPos(e);
    setStartPos({ x: e.clientX, y: e.clientY }); // Screen pos for threshold check

    // Check interaction with ACTIVE image first
    const activeLayout = imageLayouts.find(l => l.id === activeImageId);
    
    if (activeLayout && activeLayout.selection) {
       const handle = getHandle(wx, wy, activeLayout);
       if (handle) {
         setMode('resizing');
         setActiveHandle(handle);
         setInitialSelection({ ...activeLayout.selection });
         onInteractionStart(); // Save History
         return;
       }
       if (isPointInSelection(wx, wy, activeLayout)) {
         setMode('moving');
         setInitialSelection({ ...activeLayout.selection });
         onInteractionStart(); // Save History
         return;
       }
    }

    // Check if clicked on ANY image to select it or start drawing
    const clickedImage = getImageAtWorldPos(wx, wy);
    
    if (clickedImage) {
      if (clickedImage.id !== activeImageId) {
        onSelectImage(clickedImage.id);
      }
      
      // Prepare for drawing
      setMode('drawing');
      onInteractionStart(); // Save History
      
      // Calculate local start pos
      const lx = wx - clickedImage.worldX;
      const ly = wy - clickedImage.worldY;
      
      onUpdate(clickedImage.id, { 
        selection: { x: lx, y: ly, w: 0, h: 0 },
        excludedCells: [],
        winners: []
      });
    } else {
      // Clicked on empty space (void) -> Pan
      setMode('panning');
      setStartPos({ x: e.clientX, y: e.clientY });
      setInitialPan({ ...pan });
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    e.preventDefault();
    
    // Update pointer position for multi-touch
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Handle Pinch Zoom
    if (activePointers.current.size === 2 && pinchStartInfo.current) {
      const points = Array.from(activePointers.current.values());
      const p1 = points[0];
      const p2 = points[1];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        // New Scale
        const scaleRatio = dist / pinchStartInfo.current.dist;
        let newScale = pinchStartInfo.current.scale * scaleRatio;
        newScale = Math.min(Math.max(newScale, 0.1), 5); // Clamp scale

        // Calculate New Pan to keep the worldPoint under the center
        // NewPan = ScreenCenter - WorldPoint * NewScale
        const screenX = cx - rect.left;
        const screenY = cy - rect.top;
        
        const newPanX = screenX - pinchStartInfo.current.worldPoint.x * newScale;
        const newPanY = screenY - pinchStartInfo.current.worldPoint.y * newScale;

        setScale(newScale);
        setPan({ x: newPanX, y: newPanY });
      }
      return; // Stop other processing
    }

    const { x: wx, y: wy } = getWorldPos(e);
    const activeLayout = imageLayouts.find(l => l.id === activeImageId);

    // Cursor Updates
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

    if (!activeLayout) return; // Should have been set in Down

    if (mode === 'drawing' && activeLayout.selection) {
      // Localize
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
       
       // Clamp to image bounds
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
    
    // Remove pointer
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      pinchStartInfo.current = null;
    }
    
    // If we were pinching, don't trigger clicks or other end events immediately
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

      // Click to Exclude
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
       onInteractionStart(); // Save History
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
      className={`w-full h-full bg-gray-200 select-none ${isPanningMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
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