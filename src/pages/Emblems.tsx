

import { useState, useEffect } from 'react';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { cn } from '../lib/utils';
import { Download, Shield, RefreshCw } from 'lucide-react';
import { useEmblemArtVersion, useEmblemColors, useEmblemImage } from '../components/UI/Emblem';
import {
    EMBLEM_ICON_COUNT,
    EMBLEM_ICON_SHEET,
    EMBLEM_SHAPE_COUNT,
    EMBLEM_SHAPE_SHEET,
    emblemCellBackground,
} from '../utils/emblem';

/**
 * The emblem designer.
 *
 * Nothing in here composes an emblem any more: the holder + tinted shape +
 * tinted symbol layering, and the multiply-then-alpha-mask tint, live in
 * src/utils/emblem.ts and are shared with <ClanBadge>. This page picks four
 * values, hands them to useEmblemImage() and shows/exports the PNG that comes
 * back. The 128px export size and pixelRatio 1 are pinned here so the exported
 * file is the same 128x128 on every screen.
 */
const EMBLEM_SIZE = 128; // exported PNG edge

export default function Emblems() {
    const colors = useEmblemColors();
    const artVersion = useEmblemArtVersion();

    const [activeTab, setActiveTab] = useState<'pattern' | 'symbol'>('pattern');
    const [foregroundColorId, setForegroundColorId] = useState<number>(8);
    const [backgroundColorId, setBackgroundColorId] = useState<number>(0);
    const [shapeIndex, setShapeIndex] = useState<number>(0);
    const [iconIndex, setIconIndex] = useState<number>(0);

    const { background: backgroundColors, foreground: foregroundColors } = colors;

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

    const getHex = (id: number) => colors.byId.get(id)?.HexCode || '#FFFFFF';

    const { src: previewUrl } = useEmblemImage(
        {
            shape: shapeIndex,
            icon: iconIndex,
            shapeColorId: backgroundColorId,
            iconColorId: foregroundColorId,
        },
        EMBLEM_SIZE,
        { pixelRatio: 1 },
    );

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
        if (!colors.loaded) return;
        const bgKeys = backgroundColors.map(c => c.ColorId);
        const fgKeys = foregroundColors.map(c => c.ColorId);
        setForegroundColorId(fgKeys[Math.floor(Math.random() * fgKeys.length)] || fgKeys[0]);
        setBackgroundColorId(bgKeys[Math.floor(Math.random() * bgKeys.length)]);
        setShapeIndex(Math.floor(Math.random() * EMBLEM_SHAPE_COUNT));
        setIconIndex(Math.floor(Math.random() * EMBLEM_ICON_COUNT));
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
                            {previewUrl ? (
                                <img src={previewUrl} alt="Preview" className="w-full h-full object-contain relative z-10 drop-shadow-2xl" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-text-muted animate-pulse">
                                    Loading
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
                                        {Array.from({ length: EMBLEM_SHAPE_COUNT }).map((_, i) => (
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
                                                    style={emblemCellBackground(EMBLEM_SHAPE_SHEET, i, artVersion)}
                                                />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'symbol' && (
                                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                    <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
                                        {Array.from({ length: EMBLEM_ICON_COUNT }).map((_, i) => (
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
                                                    style={emblemCellBackground(EMBLEM_ICON_SHEET, i, artVersion)}
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
