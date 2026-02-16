

import { useState, useEffect, useRef, useMemo } from 'react';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { useGameData } from '../hooks/useGameData';
import { cn } from '../lib/utils';
import { Download, Shield, RefreshCw } from 'lucide-react';

// Constants
const EMBLEM_SIZE = 128; // Final output size
const SHAPES_GRID = 4; // 4x4
const ICONS_GRID = 8; // 8x8

interface GuildEmblemColor {
    ColorId: number;
    ColorType: 'Background' | 'Foreground';
    HexCode: string;
}

export default function Emblems() {
    const { data: colorsConfig } = useGameData<Record<string, GuildEmblemColor>>('GuildEmblemColors.json');

    const [activeTab, setActiveTab] = useState<'pattern' | 'symbol'>('pattern');
    const [foregroundColorId, setForegroundColorId] = useState<number>(8);
    const [backgroundColorId, setBackgroundColorId] = useState<number>(0);
    const [shapeIndex, setShapeIndex] = useState<number>(0);
    const [iconIndex, setIconIndex] = useState<number>(0);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const imagesRef = useRef<{ holder: HTMLImageElement; shapes: HTMLImageElement; icons: HTMLImageElement } | null>(null);
    const [imagesLoaded, setImagesLoaded] = useState(false);

    // Data processing
    const backgroundColors = useMemo(() => {
        if (!colorsConfig) return [];
        return Object.values(colorsConfig)
            .filter(c => c.ColorType === 'Background')
            .sort((a, b) => a.ColorId - b.ColorId);
    }, [colorsConfig]);

    const foregroundColors = useMemo(() => {
        if (!colorsConfig) return [];
        return Object.values(colorsConfig)
            .filter(c => c.ColorType === 'Foreground')
            .sort((a, b) => a.ColorId - b.ColorId);
    }, [colorsConfig]);

    // Pre-load images once
    useEffect(() => {
        const holderImg = new Image();
        const shapesImg = new Image();
        const iconsImg = new Image();
        let loadedCount = 0;

        const handleLoad = () => {
            loadedCount++;
            if (loadedCount === 3) {
                imagesRef.current = { holder: holderImg, shapes: shapesImg, icons: iconsImg };
                setImagesLoaded(true);
            }
        };

        holderImg.onload = handleLoad;
        shapesImg.onload = handleLoad;
        iconsImg.onload = handleLoad;

        holderImg.src = './Texture2D/EmblemHolder.png';
        shapesImg.src = './Texture2D/EmblemShapes.png';
        iconsImg.src = './Texture2D/EmblemIcons.png';
    }, []);

    // Initialize defaults
    useEffect(() => {
        if (foregroundColors.length > 0 && foregroundColorId === 8) {
            const whiteExists = foregroundColors.some(c => c.ColorId === 8);
            if (!whiteExists) setForegroundColorId(foregroundColors[0].ColorId);
        }
        if (backgroundColors.length > 0 && backgroundColorId === 0) {
            setBackgroundColorId(backgroundColors[0].ColorId);
        }
    }, [foregroundColors, backgroundColors, foregroundColorId, backgroundColorId]);

    const getHex = (id: number) => colorsConfig?.[id]?.HexCode || '#FFFFFF';

    // Drawing Logic
    useEffect(() => {
        if (!colorsConfig || !imagesLoaded || !imagesRef.current) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { holder: holderImg, shapes: shapesImg, icons: iconsImg } = imagesRef.current;

        const draw = () => {
            ctx.clearRect(0, 0, EMBLEM_SIZE, EMBLEM_SIZE);

            const drawLayer = (img: HTMLImageElement, color: string,
                sx: number, sy: number, sw: number, sh: number,
                dx: number = 0, dy: number = 0, dw: number = EMBLEM_SIZE, dh: number = EMBLEM_SIZE
            ) => {
                const offCanvas = document.createElement('canvas');
                offCanvas.width = dw;
                offCanvas.height = dh;
                const offCtx = offCanvas.getContext('2d');
                if (!offCtx) return;

                offCtx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
                offCtx.globalCompositeOperation = 'multiply';
                offCtx.fillStyle = color;
                offCtx.fillRect(0, 0, dw, dh);
                offCtx.globalCompositeOperation = 'destination-in';
                offCtx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
                ctx.drawImage(offCanvas, dx, dy);
            };

            // 1. PATTERN
            const sCols = SHAPES_GRID;
            const sW = shapesImg.width / sCols;
            const sH = shapesImg.height / SHAPES_GRID;
            const sX = (shapeIndex % sCols) * sW;
            const sY = Math.floor(shapeIndex / sCols) * sH;
            const shapeSize = EMBLEM_SIZE * 0.75;
            const shapePos = (EMBLEM_SIZE - shapeSize) / 2;
            drawLayer(shapesImg, getHex(backgroundColorId), sX, sY, sW, sH, shapePos, shapePos + 8, shapeSize, shapeSize);

            // 2. SYMBOL
            const iCols = ICONS_GRID;
            const iW = iconsImg.width / iCols;
            const iH = iconsImg.height / ICONS_GRID;
            const iX = (iconIndex % iCols) * iW;
            const iY = Math.floor(iconIndex / iCols) * iH;
            const iconSize = EMBLEM_SIZE * 0.5;
            const iconPos = (EMBLEM_SIZE - iconSize) / 2;
            drawLayer(iconsImg, getHex(foregroundColorId), iX, iY, iW, iH, iconPos, iconPos, iconSize, iconSize);

            // 3. BASE (Holder)
            drawLayer(holderImg, getHex(foregroundColorId), 0, 0, holderImg.width, holderImg.height, 0, -48, EMBLEM_SIZE, EMBLEM_SIZE);

            setPreviewUrl(canvas.toDataURL('image/png'));
        };

        draw();

    }, [colorsConfig, imagesLoaded, foregroundColorId, backgroundColorId, shapeIndex, iconIndex]);

    const handleDownload = () => {
        if (previewUrl) {
            const link = document.createElement('a');
            link.download = `emblem_${Date.now()}.png`;
            link.href = previewUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const handleRandomize = () => {
        if (!colorsConfig) return;
        const bgKeys = backgroundColors.map(c => c.ColorId);
        const fgKeys = foregroundColors.map(c => c.ColorId);
        setForegroundColorId(fgKeys[Math.floor(Math.random() * fgKeys.length)] || fgKeys[0]);
        setBackgroundColorId(bgKeys[Math.floor(Math.random() * bgKeys.length)]);
        setShapeIndex(Math.floor(Math.random() * 16));
        setIconIndex(Math.floor(Math.random() * 64));
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-12 px-4 md:px-0">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border pb-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-accent-primary/10 rounded-xl">
                        <Shield className="w-8 h-8 text-accent-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-text-primary">Guild Emblem</h1>
                        <p className="text-text-muted text-sm">Design your unique identity</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={handleRandomize}>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Randomize
                    </Button>
                    <Button onClick={handleDownload}>
                        <Download className="w-4 h-4 mr-2" />
                        Export PNG
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

                {/* LEFT COLUMN: PREVIEW & COLORS */}
                <div className="lg:col-span-12 xl:col-span-5 space-y-6">
                    <Card className="p-8 flex items-center justify-center bg-bg-secondary/30 relative overflow-hidden group min-h-[300px]">
                        <div className="absolute inset-0 bg-gradient-to-br from-accent-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="relative w-64 h-64 shadow-2xl rounded-xl transition-transform duration-300 hover:scale-105">
                            <div className="absolute inset-0 rounded-xl opacity-30 pattern-dots" />
                            <canvas ref={canvasRef} width={EMBLEM_SIZE} height={EMBLEM_SIZE} className="hidden" />
                            {previewUrl ? (
                                <img src={previewUrl} alt="Preview" className="w-full h-full object-contain relative z-10 drop-shadow-2xl" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-text-muted animate-pulse">
                                    Loading...
                                </div>
                            )}
                        </div>
                    </Card>

                    <Card className="p-6 space-y-8">
                        {/* SYMBOL COLORS (Foreground) */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-accent-primary flex justify-between items-center">
                                Symbol & Holder Color
                                <span className="text-xs text-text-muted font-normal lowercase">{getHex(foregroundColorId)}</span>
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {foregroundColors.map(c => (
                                    <button
                                        key={c.ColorId}
                                        onClick={() => setForegroundColorId(c.ColorId)}
                                        className={cn(
                                            "w-9 h-9 rounded-full border-2 shadow-sm transition-all hover:scale-110",
                                            foregroundColorId === c.ColorId
                                                ? "border-white ring-2 ring-accent-primary ring-offset-2 ring-offset-bg-secondary scale-110"
                                                : "border-transparent opacity-70 hover:opacity-100"
                                        )}
                                        style={{ backgroundColor: c.HexCode }}
                                        title={c.HexCode}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* PATTERN COLORS (Background) */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-accent-primary flex justify-between items-center">
                                Pattern Color
                                <span className="text-xs text-text-muted font-normal lowercase">{getHex(backgroundColorId)}</span>
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {backgroundColors.map(c => (
                                    <button
                                        key={c.ColorId}
                                        onClick={() => setBackgroundColorId(c.ColorId)}
                                        className={cn(
                                            "w-9 h-9 rounded-full border-2 shadow-sm transition-all hover:scale-110",
                                            backgroundColorId === c.ColorId
                                                ? "border-white ring-2 ring-accent-primary ring-offset-2 ring-offset-bg-secondary scale-110"
                                                : "border-transparent opacity-70 hover:opacity-100"
                                        )}
                                        style={{ backgroundColor: c.HexCode }}
                                        title={c.HexCode}
                                    />
                                ))}
                            </div>
                        </div>
                    </Card>
                </div>

                {/* RIGHT COLUMN: SELECTORS */}
                <div className="lg:col-span-12 xl:col-span-7">
                    <Card className="min-h-[500px] flex flex-col h-full">
                        {/* Simplified Tabs */}
                        <div className="flex border-b border-border">
                            {(['pattern', 'symbol'] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={cn(
                                        "flex-1 py-4 text-sm font-bold uppercase tracking-widest transition-all border-b-2",
                                        activeTab === tab
                                            ? "border-accent-primary text-accent-primary bg-accent-primary/5"
                                            : "border-transparent text-text-muted hover:text-text-primary hover:bg-white/5"
                                    )}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
                            {activeTab === 'pattern' && (
                                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
                                        {Array.from({ length: 16 }).map((_, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setShapeIndex(i)}
                                                className={cn(
                                                    "aspect-square rounded-lg border-2 overflow-hidden bg-black/20 transition-all group",
                                                    shapeIndex === i
                                                        ? "border-accent-primary ring-4 ring-accent-primary/20"
                                                        : "border-transparent hover:border-white/20"
                                                )}
                                            >
                                                <div className="w-full h-full opacity-60 group-hover:opacity-100 transition-opacity"
                                                    style={{
                                                        backgroundImage: 'url(./Texture2D/EmblemShapes.png)',
                                                        backgroundPosition: `${(i % 4) * (100 / 3)}% ${Math.floor(i / 4) * (100 / 3)}%`,
                                                        backgroundSize: '400% 400%',
                                                    }}
                                                />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'symbol' && (
                                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                    <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
                                        {Array.from({ length: 64 }).map((_, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setIconIndex(i)}
                                                className={cn(
                                                    "aspect-square rounded-lg border-2 overflow-hidden bg-black/20 transition-all group",
                                                    iconIndex === i
                                                        ? "border-accent-primary ring-4 ring-accent-primary/20"
                                                        : "border-transparent hover:border-white/10"
                                                )}
                                            >
                                                <div className="w-full h-full opacity-80 group-hover:opacity-100 transition-opacity"
                                                    style={{
                                                        backgroundImage: 'url(./Texture2D/EmblemIcons.png)',
                                                        backgroundPosition: `${(i % 8) * (100 / 7)}% ${Math.floor(i / 8) * (100 / 7)}%`,
                                                        backgroundSize: '800% 800%'
                                                    }}
                                                />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}

