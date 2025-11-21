import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Image as ImageIcon, Layers, Zap, Palette, 
  Sliders, Activity, Monitor, Grid, ArrowDownUp, Scissors, Tv, PenTool, 
  X, Save, FolderOpen, FlipHorizontal 
} from 'lucide-react';

// --- Helper: Color Utilities ---
const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

// --- Helper: Luminance ---
const getLuminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// --- Helper: Bayer Matrix ---
const bayerMatrix4x4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

// --- Helper: Vibrant Colors for Random Mode ---
const vibrantColors = [
    {r:255, g:0, b:100},   // Pink
    {r:0, g:255, b:200},   // Cyan
    {r:255, g:200, b:0},   // Yellow
    {r:100, g:100, b:255}, // Purple
    {r:50, g:255, b:50},   // Lime
    {r:255, g:100, b:0}    // Orange
];

export default function App() {
  // --- State ---
  const [originalImage, setOriginalImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  
  const [activeModes, setActiveModes] = useState(['pixel']); 
  
  // Presets State
  const [presets, setPresets] = useState(() => {
    try {
      const saved = localStorage.getItem('glitchPresets');
      return saved ? JSON.parse(saved) : [null, null, null];
    } catch (e) {
      return [null, null, null];
    }
  });

  // Filter Settings
  const [settings, setSettings] = useState({
    // Pixel Art
    pixelSize: 4,
    
    // Dither
    ditherAlgo: 'floyd', 
    ditherType: 'bw',    
    ditherThreshold: 128,
    ditherPixelSize: 2, 
    colorA: '#000000',   
    colorB: '#ffffff',   
    
    // BW Artistic
    contrast: 20,
    brightness: 10,
    grain: 0,

    // Chromatic
    offset: 5,
    direction: 'horizontal',

    // CRT
    scanlineIntensity: 50, 
    scanlineThickness: 2,
    vignette: 50,

    // Halftone
    dotSize: 8,
    invertHalftone: false,

    // Pixel Sort
    sortThreshold: 50, 
    sortDirection: 'horizontal',
    
    // Edge Detection
    edgeThreshold: 30,
    edgeColor: '#00ff00', 
    edgeMode: 'color', 

    // Outline / Blueprint
    outlineContrast: 50,  
    outlineLevels: 3,     
    outlineThickness: 2,
    outlineBg: '#1a1a1a',
    outlineColor: '#ffffff',
    outlineOffsetCount: 0, 
    outlineOffsetX: 10,
    outlineOffsetY: 10,
    outlineOffsetColor: '#ff0055'
  });

  // Refs
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // --- Handlers ---
  const toggleMode = (modeId) => {
    setActiveModes(prev => {
      if (prev.includes(modeId)) {
        return prev.filter(m => m !== modeId);
      } else {
        return [...prev, modeId];
      }
    });
  };

  const updateSetting = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const savePreset = (index) => {
    const newPresets = [...presets];
    newPresets[index] = {
      activeModes,
      settings,
      isFlipped, 
      timestamp: Date.now()
    };
    setPresets(newPresets);
    localStorage.setItem('glitchPresets', JSON.stringify(newPresets));
  };

  const loadPreset = (index) => {
    const p = presets[index];
    if (p) {
      setActiveModes(p.activeModes);
      setSettings(p.settings);
      setIsFlipped(p.isFlipped || false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1200;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = w / h;
          if (w > h) { w = maxDim; h = maxDim / ratio; } 
          else { h = maxDim; w = maxDim * ratio; }
        }
        setOriginalImage({ img, w, h });
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const downloadImage = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `glitch_combo_${Date.now()}.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  // --- PIPELINE ENGINE ---
  useEffect(() => {
    if (!originalImage || !canvasRef.current) return;
    
    setIsProcessing(true);

    const processTimer = setTimeout(() => {
      const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
      const { img, w, h } = originalImage;
      
      canvasRef.current.width = w;
      canvasRef.current.height = h;

      // 1. Base Draw & Transformation
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';

      // Handle Flip
      ctx.save(); 
      if (isFlipped) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(img, 0, 0, w, h);
      ctx.restore(); 

      // Define fixed order of operations for logic consistency
      const pipelineOrder = [
        'pixel',    // 1. Resizing/Pixelation first
        'bw',       // 2. Color adjustments
        'sort',     // 3. Glitch geometry
        'outline',  // 4. Generative replacements (Outline replaces content)
        'edge',     // 5. Edge detection (Additive or Replacement)
        'halftone', // 6. Pattern generators
        'dither',   // 7. Dither (Needs final brightness values)
        'chromatic',// 8. Channel shifting
        'crt'       // 9. Overlay/Screen effects last
      ];

      // Run Pipeline
      pipelineOrder.forEach(mode => {
        if (!activeModes.includes(mode)) return;

        const currentW = canvasRef.current.width;
        const currentH = canvasRef.current.height;
        const currentImageData = ctx.getImageData(0, 0, currentW, currentH);
        const data = currentImageData.data;

        // --- PIXEL ART ---
        if (mode === 'pixel') {
          const factor = Math.max(1, settings.pixelSize);
          const tinyW = Math.floor(currentW / factor);
          const tinyH = Math.floor(currentH / factor);
          
          ctx.imageSmoothingEnabled = false;
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = tinyW;
          tempCanvas.height = tinyH;
          const tempCtx = tempCanvas.getContext('2d');
          tempCtx.drawImage(canvasRef.current, 0, 0, tinyW, tinyH);
          
          ctx.clearRect(0, 0, currentW, currentH);
          ctx.drawImage(tempCanvas, 0, 0, currentW, currentH);
        }

        // --- BW ---
        else if (mode === 'bw') {
          const contrastFactor = (259 * (settings.contrast + 255)) / (255 * (259 - settings.contrast));
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            let gray = getLuminance(r, g, b);
            gray += settings.brightness;
            gray = contrastFactor * (gray - 128) + 128;
            if (settings.grain > 0) gray += (Math.random() - 0.5) * settings.grain;
            gray = Math.min(255, Math.max(0, gray));
            data[i] = data[i+1] = data[i+2] = gray;
          }
          ctx.putImageData(currentImageData, 0, 0);
        }

        // --- PIXEL SORT ---
        else if (mode === 'sort') {
          const thresh = settings.sortThreshold;
          const sortRow = (arr) => arr.sort((a, b) => getLuminance(a.r, a.g, a.b) - getLuminance(b.r, b.g, b.b));

          if (settings.sortDirection === 'horizontal') {
            for (let y = 0; y < currentH; y++) {
              let rowPixels = [];
              for (let x = 0; x < currentW; x++) {
                const i = (y * currentW + x) * 4;
                rowPixels.push({ r: data[i], g: data[i+1], b: data[i+2], a: data[i+3] });
              }
              let start = 0;
              while (start < currentW) {
                const lum = getLuminance(rowPixels[start].r, rowPixels[start].g, rowPixels[start].b);
                if (lum > thresh) {
                  let end = start + 1;
                  while (end < currentW && getLuminance(rowPixels[end].r, rowPixels[end].g, rowPixels[end].b) > thresh) end++;
                  const span = rowPixels.slice(start, end);
                  sortRow(span);
                  for (let k = 0; k < span.length; k++) rowPixels[start + k] = span[k];
                  start = end;
                } else start++;
              }
              for (let x = 0; x < currentW; x++) {
                const i = (y * currentW + x) * 4;
                data[i] = rowPixels[x].r; data[i+1] = rowPixels[x].g; data[i+2] = rowPixels[x].b;
              }
            }
          } else {
             // Vertical simplified
             for (let x = 0; x < currentW; x++) {
               let colPixels = [];
               for (let y = 0; y < currentH; y++) {
                 const i = (y * currentW + x) * 4;
                 colPixels.push({ r: data[i], g: data[i+1], b: data[i+2], a: data[i+3] });
               }
               let start = 0;
               while (start < currentH) {
                 const lum = getLuminance(colPixels[start].r, colPixels[start].g, colPixels[start].b);
                 if (lum > thresh) {
                   let end = start + 1;
                   while (end < currentH && getLuminance(colPixels[end].r, colPixels[end].g, colPixels[end].b) > thresh) end++;
                   const span = colPixels.slice(start, end);
                   sortRow(span);
                   for (let k = 0; k < span.length; k++) colPixels[start + k] = span[k];
                   start = end;
                 } else start++;
               }
               for (let y = 0; y < currentH; y++) {
                 const i = (y * currentW + x) * 4;
                 data[i] = colPixels[y].r; data[i+1] = colPixels[y].g; data[i+2] = colPixels[y].b;
               }
             }
          }
          ctx.putImageData(currentImageData, 0, 0);
        }

        // --- OUTLINE ---
        else if (mode === 'outline') {
          const contrast = settings.outlineContrast;
          const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
          const levels = Math.max(2, settings.outlineLevels);
          const levelStep = 255 / (levels - 1);
          const map = new Uint8ClampedArray(currentW * currentH);

          for (let i = 0; i < data.length; i += 4) {
            let gray = getLuminance(data[i], data[i+1], data[i+2]);
            gray = contrastFactor * (gray - 128) + 128;
            gray = Math.max(0, Math.min(255, gray));
            map[i/4] = Math.round(gray / levelStep);
          }

          const edgeMap = new Uint8ClampedArray(currentW * currentH);
          for (let y = 0; y < currentH; y++) {
            for (let x = 0; x < currentW; x++) {
              const i = y * currentW + x;
              const cur = map[i];
              if ((x < currentW - 1 && map[i+1] !== cur) || (y < currentH - 1 && map[i+currentW] !== cur)) {
                edgeMap[i] = 1;
              }
            }
          }

          const offCanvas = document.createElement('canvas');
          offCanvas.width = currentW;
          offCanvas.height = currentH;
          const offCtx = offCanvas.getContext('2d');
          const offData = offCtx.createImageData(currentW, currentH);
          const lineCol = hexToRgb(settings.outlineColor);
          const thickness = settings.outlineThickness;

          for (let i = 0; i < edgeMap.length; i++) {
            if (edgeMap[i] === 1) {
              const y = Math.floor(i / currentW);
              const x = i % currentW;
              const range = Math.ceil(thickness / 2);
              for (let dy = -range; dy <= range; dy++) {
                 for (let dx = -range; dx <= range; dx++) {
                    const ni = ((y+dy) * currentW + (x+dx)) * 4;
                    if (ni >= 0 && ni < offData.data.length) {
                       offData.data[ni] = lineCol.r; offData.data[ni+1] = lineCol.g; offData.data[ni+2] = lineCol.b; offData.data[ni+3] = 255; 
                    }
                 }
              }
            }
          }
          offCtx.putImageData(offData, 0, 0);

          ctx.fillStyle = settings.outlineBg;
          ctx.fillRect(0, 0, currentW, currentH);
          
          // Offsets
          if (settings.outlineOffsetCount > 0) {
             const echoC = document.createElement('canvas');
             echoC.width = currentW; echoC.height = currentH;
             const echoCtx = echoC.getContext('2d');
             echoCtx.drawImage(offCanvas, 0, 0);
             echoCtx.globalCompositeOperation = 'source-in';
             echoCtx.fillStyle = settings.outlineOffsetColor;
             echoCtx.fillRect(0, 0, currentW, currentH);
             ctx.globalAlpha = 0.6; 
             for (let k = settings.outlineOffsetCount; k > 0; k--) {
                ctx.drawImage(echoC, settings.outlineOffsetX * k, settings.outlineOffsetY * k);
             }
             ctx.globalAlpha = 1.0;
          }
          ctx.drawImage(offCanvas, 0, 0);
        }

        // --- EDGE DETECTION ---
        else if (mode === 'edge') {
          const grayscale = new Uint8ClampedArray(currentW * currentH);
          for (let i = 0; i < data.length; i+=4) grayscale[i/4] = getLuminance(data[i], data[i+1], data[i+2]);
          
          const output = ctx.createImageData(currentW, currentH);
          const out = output.data;
          const thresh = settings.edgeThreshold;
          const neon = hexToRgb(settings.edgeColor);
          const getP = (x, y) => (x<0||x>=currentW||y<0||y>=currentH) ? 0 : grayscale[y*currentW+x];

          for (let y = 0; y < currentH; y++) {
            for (let x = 0; x < currentW; x++) {
              const gx = -1*getP(x-1,y-1) + getP(x+1,y-1) - 2*getP(x-1,y) + 2*getP(x+1,y) - getP(x-1,y+1) + getP(x+1,y+1);
              const gy = -1*getP(x-1,y-1) - 2*getP(x,y-1) - getP(x+1,y-1) + getP(x-1,y+1) + 2*getP(x,y+1) + getP(x+1,y+1);
              const i = (y*currentW+x)*4;
              if (Math.sqrt(gx*gx + gy*gy) > thresh) {
                if (settings.edgeMode === 'color') { out[i]=neon.r; out[i+1]=neon.g; out[i+2]=neon.b; } 
                else { out[i]=255; out[i+1]=255; out[i+2]=255; }
                out[i+3]=255;
              } else {
                out[i]=0; out[i+1]=0; out[i+2]=0; out[i+3]=255;
              }
            }
          }
          ctx.putImageData(output, 0, 0);
        }

        // --- HALFTONE ---
        else if (mode === 'halftone') {
           const tempC = document.createElement('canvas');
           tempC.width = currentW; tempC.height = currentH;
           const tempCtx = tempC.getContext('2d');
           
           tempCtx.fillStyle = settings.invertHalftone ? '#000000' : '#ffffff';
           tempCtx.fillRect(0, 0, currentW, currentH);
           tempCtx.fillStyle = settings.invertHalftone ? '#ffffff' : '#000000';
           const step = Math.max(4, settings.dotSize);

           for (let y = 0; y < currentH; y += step) {
             for (let x = 0; x < currentW; x += step) {
               const i = (Math.min(currentH-1, Math.floor(y + step/2)) * currentW + Math.min(currentW-1, Math.floor(x + step/2))) * 4;
               const lum = getLuminance(data[i], data[i+1], data[i+2]) / 255;
               const radius = settings.invertHalftone ? (lum * step / 2) : ((1 - lum) * step / 2);
               if (radius > 0.5) {
                 tempCtx.beginPath();
                 tempCtx.arc(x + step/2, y + step/2, radius, 0, Math.PI * 2);
                 tempCtx.fill();
               }
             }
           }
           ctx.drawImage(tempC, 0, 0);
        }

        // --- DITHER ---
        else if (mode === 'dither') {
          const grayBuffer = new Float32Array(currentW * currentH);
          for (let i = 0; i < currentW * currentH; i++) {
              grayBuffer[i] = getLuminance(data[i*4], data[i*4+1], data[i*4+2]);
          }
          const dark = hexToRgb(settings.colorA);
          const light = hexToRgb(settings.colorB);
          const threshold = settings.ditherThreshold;

          for (let y = 0; y < currentH; y++) {
            for (let x = 0; x < currentW; x++) {
              const i = y * currentW + x;
              let isLight = false;
              
              if (settings.ditherAlgo === 'bayer') {
                 const map = Math.floor((grayBuffer[i] / 255) * 17);
                 isLight = map > bayerMatrix4x4[y % 4][x % 4];
              } 
              else if (settings.ditherAlgo === 'threshold') {
                 isLight = grayBuffer[i] > threshold;
              }
              else {
                 const oldVal = grayBuffer[i];
                 const newVal = oldVal > threshold ? 255 : 0;
                 const error = oldVal - newVal;
                 isLight = newVal === 255;
                 
                 if (settings.ditherAlgo === 'floyd') {
                    if (x+1<currentW) grayBuffer[i+1]+=error*7/16;
                    if (y+1<currentH&&x-1>=0) grayBuffer[i+currentW-1]+=error*3/16;
                    if (y+1<currentH) grayBuffer[i+currentW]+=error*5/16;
                    if (y+1<currentH&&x+1<currentW) grayBuffer[i+currentW+1]+=error*1/16;
                 } else { // Atkinson
                    const f = 1/8;
                    if (x+1<currentW) grayBuffer[i+1]+=error*f;
                    if (x+2<currentW) grayBuffer[i+2]+=error*f;
                    if (x-1>=0&&y+1<currentH) grayBuffer[i+currentW-1]+=error*f;
                    if (y+1<currentH) grayBuffer[i+currentW]+=error*f;
                    if (x+1<currentW&&y+1<currentH) grayBuffer[i+currentW+1]+=error*f;
                    if (y+2<currentH) grayBuffer[i+currentW*2]+=error*f;
                 }
              }

              const idx = i * 4;
              if (settings.ditherType === 'random' && isLight) {
                 const hash = Math.floor(Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453));
                 const col = vibrantColors[hash % vibrantColors.length];
                 data[idx]=col.r; data[idx+1]=col.g; data[idx+2]=col.b;
              } else {
                 const t = isLight ? light : dark;
                 if (settings.ditherType === 'bw') { const v = isLight?255:0; data[idx]=v; data[idx+1]=v; data[idx+2]=v; }
                 else { data[idx]=t.r; data[idx+1]=t.g; data[idx+2]=t.b; }
              }
              data[idx+3] = 255;
            }
          }
          ctx.putImageData(currentImageData, 0, 0);
        }

        // --- CHROMATIC ---
        else if (mode === 'chromatic') {
           const off = settings.offset;
           const temp = ctx.createImageData(currentW, currentH);
           const tData = temp.data;
           for(let y=0;y<currentH;y++){
             for(let x=0;x<currentW;x++){
               const i = (y*currentW+x)*4;
               let rx = x + off, ry = y;
               let bx = x - off, by = y;
               if(settings.direction === 'vertical'){ rx=x; ry=y+off; bx=x; by=y-off; }
               rx = Math.min(currentW-1, Math.max(0, rx)); ry = Math.min(currentH-1, Math.max(0, ry));
               bx = Math.min(currentW-1, Math.max(0, bx)); by = Math.min(currentH-1, Math.max(0, by));
               const ri = (ry*currentW+rx)*4;
               const bi = (by*currentW+bx)*4;
               tData[i] = data[ri]; tData[i+1] = data[i+1]; tData[i+2] = data[bi+2]; tData[i+3] = 255;
             }
           }
           ctx.putImageData(temp, 0, 0);
        }

        // --- CRT ---
        else if (mode === 'crt') {
           const cx = currentW/2; const cy = currentH/2;
           const maxD = Math.sqrt(cx*cx + cy*cy);
           const vig = settings.vignette/100;
           const scanA = settings.scanlineIntensity/100;
           const thick = settings.scanlineThickness;
           
           for(let y=0;y<currentH;y++){
              // Scanline factor
              const isScan = (y % thick) === 0;
              for(let x=0;x<currentW;x++){
                 const i = (y*currentW+x)*4;
                 // Vignette
                 const d = Math.sqrt((x-cx)**2 + (y-cy)**2);
                 const dim = 1 - ((d/maxD)*vig);
                 // Combine
                 let mult = dim;
                 if(isScan) mult *= (1-scanA);
                 
                 data[i]*=mult; data[i+1]*=mult; data[i+2]*=mult;
              }
           }
           ctx.putImageData(currentImageData, 0, 0);
        }

      });

      setPreviewUrl(canvasRef.current.toDataURL('image/png'));
      setIsProcessing(false);
    }, 20);

    return () => clearTimeout(processTimer);

  }, [originalImage, activeModes, settings, isFlipped]);

  const menuItems = [
    { id: 'pixel', icon: Monitor, label: 'Pixel' },
    { id: 'dither', icon: Layers, label: 'Dither' },
    { id: 'bw', icon: Palette, label: 'Mono' },
    { id: 'chromatic', icon: Activity, label: 'RGB' },
    { id: 'crt', icon: Tv, label: 'CRT' },
    { id: 'halftone', icon: Grid, label: 'Dot' },
    { id: 'sort', icon: ArrowDownUp, label: 'Sort' },
    { id: 'edge', icon: Scissors, label: 'Edge' },
    { id: 'outline', icon: PenTool, label: 'Blueprint' },
  ];

  // Renders settings for a specific mode
  const renderSettings = (mode) => {
     if (mode === 'pixel') return (
       <div key="pixel" className="space-y-2 animate-in fade-in pt-2 border-t border-neutral-800 first:border-0 first:pt-0">
          <div className="flex justify-between text-xs font-bold text-indigo-400"><span>Pixel Art Settings</span></div>
          <div className="flex justify-between text-xs"><span>Size</span><span className="text-neutral-400">{settings.pixelSize}px</span></div>
          <input type="range" min="2" max="64" step="2" value={settings.pixelSize} onChange={(e) => updateSetting('pixelSize', parseInt(e.target.value))} className="w-full h-2 bg-neutral-800 rounded-lg accent-indigo-500" />
       </div>
     );
     if (mode === 'dither') return (
        <div key="dither" className="space-y-3 animate-in fade-in pt-2 border-t border-neutral-800">
          <div className="flex justify-between text-xs font-bold text-indigo-400"><span>Dither Settings</span></div>
           <div className="space-y-2">
            <select value={settings.ditherAlgo} onChange={(e) => updateSetting('ditherAlgo', e.target.value)} className="w-full bg-neutral-800 border border-neutral-700 rounded p-1 text-xs text-white">
              <option value="floyd">Floyd-Steinberg</option>
              <option value="atkinson">Atkinson</option>
              <option value="bayer">Bayer 4x4</option>
            </select>
            <select value={settings.ditherType} onChange={(e) => updateSetting('ditherType', e.target.value)} className="w-full bg-neutral-800 border border-neutral-700 rounded p-1 text-xs text-white">
              <option value="bw">Black & White</option>
              <option value="duotone">Duotone</option>
              <option value="random">Random</option>
            </select>
          </div>
          <input type="range" min="0" max="255" value={settings.ditherThreshold} onChange={(e) => updateSetting('ditherThreshold', parseInt(e.target.value))} className="w-full h-2 bg-neutral-800 rounded-lg accent-indigo-500" />
          {settings.ditherType === 'duotone' && (
             <div className="flex gap-2">
                <input type="color" value={settings.colorA} onChange={(e)=>updateSetting('colorA', e.target.value)} className="flex-1 bg-transparent h-6" />
                <input type="color" value={settings.colorB} onChange={(e)=>updateSetting('colorB', e.target.value)} className="flex-1 bg-transparent h-6" />
             </div>
          )}
        </div>
     );
     if (mode === 'outline') return (
        <div key="outline" className="space-y-3 animate-in fade-in pt-2 border-t border-neutral-800">
           <div className="flex justify-between text-xs font-bold text-indigo-400"><span>Blueprint Settings</span></div>
           <div className="flex gap-2"><span className="text-xs w-16">Contrast</span><input type="range" className="flex-1 h-1" min="0" max="200" value={settings.outlineContrast} onChange={(e)=>updateSetting('outlineContrast', parseInt(e.target.value))} /></div>
           <div className="flex gap-2"><span className="text-xs w-16">Levels</span><input type="range" className="flex-1 h-1" min="2" max="6" value={settings.outlineLevels} onChange={(e)=>updateSetting('outlineLevels', parseInt(e.target.value))} /></div>
           <div className="flex gap-2"><span className="text-xs w-16">Offsets</span><input type="range" className="flex-1 h-1" min="0" max="5" value={settings.outlineOffsetCount} onChange={(e)=>updateSetting('outlineOffsetCount', parseInt(e.target.value))} /></div>
           <div className="flex gap-2">
              <input type="color" value={settings.outlineBg} onChange={(e)=>updateSetting('outlineBg', e.target.value)} className="flex-1 h-6 bg-transparent" />
              <input type="color" value={settings.outlineColor} onChange={(e)=>updateSetting('outlineColor', e.target.value)} className="flex-1 h-6 bg-transparent" />
              {settings.outlineOffsetCount > 0 && <input type="color" value={settings.outlineOffsetColor} onChange={(e)=>updateSetting('outlineOffsetColor', e.target.value)} className="flex-1 h-6 bg-transparent" />}
           </div>
        </div>
     );
     if (mode === 'crt') return (
        <div key="crt" className="space-y-2 animate-in fade-in pt-2 border-t border-neutral-800">
           <div className="flex justify-between text-xs font-bold text-indigo-400"><span>CRT Settings</span></div>
           <input type="range" min="0" max="100" value={settings.scanlineIntensity} onChange={(e)=>updateSetting('scanlineIntensity', parseInt(e.target.value))} className="w-full h-2 bg-neutral-800 rounded-lg accent-indigo-500" />
           <input type="range" min="0" max="100" value={settings.vignette} onChange={(e)=>updateSetting('vignette', parseInt(e.target.value))} className="w-full h-2 bg-neutral-800 rounded-lg accent-indigo-500" />
        </div>
     );
     if (mode === 'sort') return (
        <div key="sort" className="space-y-2 animate-in fade-in pt-2 border-t border-neutral-800">
           <div className="flex justify-between text-xs font-bold text-indigo-400"><span>Pixel Sort</span></div>
           <div className="flex justify-between text-xs"><span>Threshold</span><span className="text-neutral-400">{settings.sortThreshold}</span></div>
           <input type="range" min="0" max="255" value={settings.sortThreshold} onChange={(e)=>updateSetting('sortThreshold', parseInt(e.target.value))} className="w-full h-2 bg-neutral-800 rounded-lg accent-indigo-500" />
           <div className="flex bg-neutral-800 rounded p-0.5">
              <button onClick={()=>updateSetting('sortDirection', 'horizontal')} className={`flex-1 text-[10px] py-1 rounded ${settings.sortDirection==='horizontal'?'bg-neutral-600 text-white':'text-neutral-400'}`}>Horizontal</button>
              <button onClick={()=>updateSetting('sortDirection', 'vertical')} className={`flex-1 text-[10px] py-1 rounded ${settings.sortDirection==='vertical'?'bg-neutral-600 text-white':'text-neutral-400'}`}>Vertical</button>
           </div>
        </div>
     );
     if (mode === 'edge') return (
        <div key="edge" className="space-y-2 animate-in fade-in pt-2 border-t border-neutral-800">
           <div className="flex justify-between text-xs font-bold text-indigo-400"><span>Edge Detection</span></div>
           <input type="range" min="5" max="100" value={settings.edgeThreshold} onChange={(e)=>updateSetting('edgeThreshold', parseInt(e.target.value))} className="w-full h-2 bg-neutral-800 rounded-lg accent-indigo-500" />
           <div className="flex gap-2">
              <input type="color" value={settings.edgeColor} onChange={(e)=>updateSetting('edgeColor', e.target.value)} className="h-6 w-6 bg-transparent" />
              <select value={settings.edgeMode} onChange={(e)=>updateSetting('edgeMode', e.target.value)} className="flex-1 bg-neutral-800 text-[10px] rounded border border-neutral-700">
                 <option value="color">Neon</option>
                 <option value="white">White</option>
              </select>
           </div>
        </div>
     );
     if (mode === 'halftone') return (
        <div key="halftone" className="space-y-2 animate-in fade-in pt-2 border-t border-neutral-800">
           <div className="flex justify-between text-xs font-bold text-indigo-400"><span>Halftone</span></div>
           <div className="flex justify-between text-xs"><span>Dot Size</span><span className="text-neutral-400">{settings.dotSize}px</span></div>
           <input type="range" min="4" max="30" value={settings.dotSize} onChange={(e)=>updateSetting('dotSize', parseInt(e.target.value))} className="w-full h-2 bg-neutral-800 rounded-lg accent-indigo-500" />
           <button onClick={()=>updateSetting('invertHalftone', !settings.invertHalftone)} className="text-[10px] w-full bg-neutral-800 py-1 rounded border border-neutral-700 hover:bg-neutral-700">{settings.invertHalftone ? 'Invert: ON' : 'Invert: OFF'}</button>
        </div>
     );
     if (mode === 'chromatic') return (
        <div key="chromatic" className="pt-2 border-t border-neutral-800 animate-in fade-in">
           <div className="text-xs font-bold text-indigo-400 mb-2">Chromatic RGB</div>
           <input type="range" min="0" max="50" value={settings.offset} onChange={(e)=>updateSetting('offset',parseInt(e.target.value))} className="w-full h-2 bg-neutral-800 accent-indigo-500"/>
           <div className="flex bg-neutral-800 rounded p-0.5 mt-2">
              <button onClick={()=>updateSetting('direction', 'horizontal')} className={`flex-1 text-[10px] py-1 rounded ${settings.direction==='horizontal'?'bg-neutral-600 text-white':'text-neutral-400'}`}>Horiz</button>
              <button onClick={()=>updateSetting('direction', 'vertical')} className={`flex-1 text-[10px] py-1 rounded ${settings.direction==='vertical'?'bg-neutral-600 text-white':'text-neutral-400'}`}>Vert</button>
           </div>
        </div>
     );
     if (mode === 'bw') return (
        <div key="bw" className="pt-2 border-t border-neutral-800 animate-in fade-in">
           <div className="text-xs font-bold text-indigo-400 mb-2">Mono Art</div>
           <div className="flex justify-between text-[10px] text-neutral-500"><span>Contrast</span><span>Bright</span><span>Grain</span></div>
           <div className="space-y-1">
              <input type="range" min="-50" max="100" value={settings.contrast} onChange={(e)=>updateSetting('contrast',parseInt(e.target.value))} className="w-full h-1 bg-neutral-800 accent-indigo-500"/>
              <input type="range" min="-100" max="100" value={settings.brightness} onChange={(e)=>updateSetting('brightness',parseInt(e.target.value))} className="w-full h-1 bg-neutral-800 accent-indigo-500"/>
              <input type="range" min="0" max="100" value={settings.grain} onChange={(e)=>updateSetting('grain',parseInt(e.target.value))} className="w-full h-1 bg-neutral-800 accent-indigo-500"/>
           </div>
        </div>
     );
     return null;
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-indigo-500 selection:text-white flex flex-col md:flex-row overflow-hidden">
      
      <aside className="w-full md:w-80 bg-neutral-900 border-r border-neutral-800 flex flex-col h-[40vh] md:h-screen z-10 shadow-2xl">
        <div className="p-6 border-b border-neutral-800 flex items-center space-x-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center"><Zap size={18} className="text-white" /></div>
          <h1 className="text-xl font-bold tracking-tight text-white">Glitch Studio</h1>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          
          {/* Presets Section */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-500">Presets</label>
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map(idx => {
                 const hasPreset = !!presets[idx];
                 return (
                    <div key={idx} className="flex flex-col gap-1">
                       <button onClick={() => loadPreset(idx)} disabled={!hasPreset} className={`flex items-center justify-center gap-1 py-2 rounded-lg border text-[10px] font-medium transition-colors ${hasPreset ? 'bg-neutral-800 border-neutral-700 hover:bg-neutral-700 text-white' : 'bg-neutral-900 border-neutral-800 text-neutral-600 cursor-not-allowed'}`}>
                          <FolderOpen size={12} /> Load {idx + 1}
                       </button>
                       <button onClick={() => savePreset(idx)} className="flex items-center justify-center gap-1 py-2 rounded-lg bg-neutral-800 border border-neutral-700 hover:bg-indigo-600 hover:border-indigo-500 hover:text-white text-neutral-400 text-[10px] transition-colors">
                          <Save size={12} /> Save {idx + 1}
                       </button>
                    </div>
                 );
              })}
            </div>
          </div>

          {/* Active Modes Grid */}
          <div className="space-y-3 border-t border-neutral-800 pt-4">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-500">Effect Layers</label>
            <div className="grid grid-cols-3 gap-2">
              {menuItems.map((item) => {
                const isActive = activeModes.includes(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleMode(item.id)}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all duration-200 ${
                      isActive
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-900/20'
                        : 'bg-neutral-800 border-transparent hover:bg-neutral-700 text-neutral-400'
                    }`}
                  >
                    <item.icon size={18} className="mb-1" />
                    <span className="text-[10px] font-medium">{item.label}</span>
                  </button>
                );
              })}
            </div>
            {activeModes.length > 0 && (
               <button onClick={() => setActiveModes([])} className="text-xs text-neutral-500 hover:text-red-400 flex items-center gap-1 w-full justify-center mt-2">
                  <X size={12}/> Clear All Effects
               </button>
            )}
          </div>

          {/* Dynamic Settings Stack */}
          {activeModes.length > 0 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300 pt-2 border-t border-neutral-800">
              <div className="flex items-center space-x-2 mb-2">
                <Sliders size={16} className="text-indigo-500" />
                <span className="text-sm font-semibold text-white">Adjustments</span>
              </div>
              <div className="space-y-4">
                 {menuItems.map(item => activeModes.includes(item.id) && renderSettings(item.id))}
              </div>
            </div>
          )}
        </div>
        
        <div className="p-6 border-t border-neutral-800 bg-neutral-900">
           <button 
              onClick={downloadImage}
              disabled={!previewUrl || isProcessing}
              className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white py-3 rounded-xl font-medium transition-all duration-200 shadow-lg shadow-indigo-900/20"
            >
              <Download size={18} />
              <span>Save Image</span>
            </button>
        </div>
      </aside>

      <main className="flex-1 relative bg-[#0a0a0a] overflow-hidden flex flex-col">
        <header className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start pointer-events-none z-20">
          <div className="pointer-events-auto flex gap-2">
             <button 
                onClick={() => fileInputRef.current.click()}
                className="flex items-center space-x-2 bg-neutral-900/80 backdrop-blur-md border border-neutral-800 hover:bg-white hover:text-black text-white px-4 py-2.5 rounded-xl transition-all duration-300 group"
             >
               <Upload size={18} className="group-hover:-translate-y-0.5 transition-transform" />
               <span className="text-sm font-medium">Upload New</span>
             </button>
             
             {/* Flip Toggle Button */}
             <button 
                onClick={() => setIsFlipped(!isFlipped)}
                className={`flex items-center space-x-2 backdrop-blur-md border px-4 py-2.5 rounded-xl transition-all duration-300 ${isFlipped ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-neutral-900/80 border-neutral-800 text-neutral-400 hover:text-white'}`}
                title="Flip Horizontal"
             >
               <FlipHorizontal size={18} />
             </button>

             <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
          </div>
          
          {isProcessing && (
            <div className="flex items-center space-x-2 px-4 py-2 bg-neutral-900/80 backdrop-blur border border-neutral-800 rounded-full">
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs font-medium text-indigo-400">Rendering...</span>
            </div>
          )}
        </header>

        <div className="flex-1 flex items-center justify-center p-8 md:p-12 overflow-auto">
          <div className={`relative transition-all duration-500 ${originalImage ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}>
            <canvas ref={canvasRef} className="hidden" />
            {previewUrl ? (
               <img src={previewUrl} alt="Processed Preview" className="max-w-full max-h-[80vh] shadow-2xl shadow-black rounded-sm border border-neutral-800 object-contain" style={{ imageRendering: 'pixelated' }} />
            ) : <div className="hidden"></div>}
          </div>
          {!originalImage && (
            <div className="absolute inset-0 flex items-center justify-center z-0">
              <div className="text-center space-y-4 animate-in fade-in duration-700">
                <div className="w-24 h-24 bg-neutral-900 rounded-3xl border border-neutral-800 flex items-center justify-center mx-auto shadow-2xl rotate-3"><ImageIcon size={40} className="text-neutral-700" /></div>
                <div><h2 className="text-2xl font-bold text-white">No Image Loaded</h2><p className="text-neutral-500 mt-2 max-w-xs mx-auto">Upload an image to start glitching.</p></div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}