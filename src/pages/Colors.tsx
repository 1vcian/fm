import { useState, useCallback, useEffect } from 'react';
import { Card } from '../components/UI/Card';
import { Input } from '../components/UI/Input';
import { Button } from '../components/UI/Button';
import { Palette, Copy, Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface ColorStop {
    id: number;
    hex: string;
    alpha: number;
}

export default function Colors() {
    const [text, setText] = useState('1vcian.me/fm');
    const [startColor, setStartColor] = useState('#ff0000');
    const [startAlpha, setStartAlpha] = useState(255);
    const [endColor, setEndColor] = useState('#FFD700');
    const [endAlpha, setEndAlpha] = useState(255);
    const [middleColors, setMiddleColors] = useState<ColorStop[]>([]);
    const [mode, setMode] = useState<'chars' | 'words'>('chars');
    const [generatedCode, setGeneratedCode] = useState('');
    const [useShortHex, setUseShortHex] = useState(true);
    const [nextId, setNextId] = useState(1);

    // --- Logic ---

    const addMiddleColor = () => {
        setMiddleColors([...middleColors, { id: nextId, hex: '#00FF00', alpha: 255 }]);
        setNextId(nextId + 1);
    };

    const removeMiddleColor = (id: number) => {
        setMiddleColors(middleColors.filter(c => c.id !== id));
    };

    const updateMiddleColor = (id: number, hex: string) => {
        setMiddleColors(middleColors.map(c => c.id === id ? { ...c, hex } : c));
    };

    const updateMiddleAlpha = (id: number, alpha: number) => {
        setMiddleColors(middleColors.map(c => c.id === id ? { ...c, alpha } : c));
    };

    const hexToRgba = (hex: string) => {
        const h = hex.replace('#', '');
        if (h.length === 8) {
            return {
                r: parseInt(h.substring(0, 2), 16),
                g: parseInt(h.substring(2, 4), 16),
                b: parseInt(h.substring(4, 6), 16),
                a: parseInt(h.substring(6, 8), 16)
            };
        }
        return {
            r: parseInt(h.substring(0, 2), 16),
            g: parseInt(h.substring(2, 4), 16),
            b: parseInt(h.substring(4, 6), 16),
            a: 255
        };
    };

    const rgbaToHex = (r: number, g: number, b: number, a: number = 255) => {
        const toHex = (c: number) => {
            const hex = Math.round(c).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        const hex = '#' + toHex(r) + toHex(g) + toHex(b);
        return a < 255 ? hex + toHex(a) : hex;
    };

    const tryShortenHex = (hex: string) => {
        const h = hex.replace('#', '').toLowerCase();
        if (h.length !== 6 && h.length !== 8) return h;
        
        const pairs = h.match(/.{2}/g) || [];
        if (pairs.every(p => p[0] === p[1])) {
            return pairs.map(p => p[0]).join('');
        }
        return h;
    };

    const shortenHex = (hex: string) => {
        const h = hex.replace('#', '').toLowerCase();
        const pairs = h.match(/.{2}/g) || [];
        return pairs.map(p => {
            const val = Math.round(parseInt(p, 16) / 17);
            return val.toString(16);
        }).join('');
    };

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const getGradientColors = useCallback((colors: { hex: string; alpha: number }[], steps: number) => {
        if (steps <= 0) return [];
        if (steps === 1) return [rgbaToHex(...Object.values(hexToRgba(colors[0].hex)) as [number, number, number, number], colors[0].alpha)];

        const result: string[] = [];
        const segmentCount = colors.length - 1;

        for (let i = 0; i < steps; i++) {
            const t = i / (steps - 1);
            const segmentPos = t * segmentCount;
            const segmentIdx = Math.min(Math.floor(segmentPos), segmentCount - 1);
            const segmentProgress = segmentPos - segmentIdx;

            const c1 = hexToRgba(colors[segmentIdx].hex);
            c1.a = colors[segmentIdx].alpha;
            const c2 = hexToRgba(colors[segmentIdx + 1].hex);
            c2.a = colors[segmentIdx + 1].alpha;

            const r = lerp(c1.r, c2.r, segmentProgress);
            const g = lerp(c1.g, c2.g, segmentProgress);
            const b = lerp(c1.b, c2.b, segmentProgress);
            const a = lerp(c1.a, c2.a, segmentProgress);

            result.push(rgbaToHex(r, g, b, a));
        }
        return result;
    }, []);

    useEffect(() => {
        if (!text) {
            setGeneratedCode('');
            return;
        }

        const allColors = [
            { hex: startColor, alpha: startAlpha },
            ...middleColors.map(c => ({ hex: c.hex, alpha: c.alpha })),
            { hex: endColor, alpha: endAlpha }
        ];

        let segments: { text: string; isSpace: boolean }[] = [];

        if (mode === 'chars') {
            segments = text.split('').map(char => ({
                text: char,
                isSpace: /\s/.test(char)
            }));
        } else {
            // Words
            segments = text.split(/(\s+)/).map(part => ({
                text: part,
                isSpace: /^\s+$/.test(part)
            })).filter(p => p.text.length > 0);
        }

        const colorStepsCount = segments.filter(s => !s.isSpace).length;
        const gradientColors = getGradientColors(allColors, Math.max(colorStepsCount, 2));

        let colorIndex = 0;
        const resultItems = segments.map((seg) => {
            if (seg.isSpace) {
                return { ...seg, color: null };
            }
            const color = gradientColors[Math.min(colorIndex, gradientColors.length - 1)];
            colorIndex++;
            return { ...seg, color };
        });

        // Generate Preview HTML (React Nodes logic simulation)
        // We'll store array of objects to render
        // Actually for simplicity, we treat previewHtml as a list of styled objects

        // Generate Code
        const code = resultItems.map(item => {
            if (item.isSpace || !item.color) return item.text;
            const hex = useShortHex ? shortenHex(item.color) : tryShortenHex(item.color);
            return `<#${hex}>${item.text}`;
        }).join('');

        setGeneratedCode(code);

        setGeneratedCode(code);

    }, [text, startColor, startAlpha, endColor, endAlpha, middleColors, mode, getGradientColors, useShortHex]);

    // Helpers for rendering
    const renderPreview = () => {
        if (!text) return <span className="text-text-muted italic">Type something...</span>;

        const allColors = [
            { hex: startColor, alpha: startAlpha },
            ...middleColors.map(c => ({ hex: c.hex, alpha: c.alpha })),
            { hex: endColor, alpha: endAlpha }
        ];
        let segments: { text: string; isSpace: boolean }[] = [];

        if (mode === 'chars') {
            segments = text.split('').map(char => ({
                text: char,
                isSpace: /\s/.test(char)
            }));
        } else {
            segments = text.split(/(\s+)/).map(part => ({
                text: part,
                isSpace: /^\s+$/.test(part)
            })).filter(p => p.text.length > 0);
        }

        const colorStepsCount = segments.filter(s => !s.isSpace).length;
        const gradientColors = getGradientColors(allColors, Math.max(colorStepsCount, 2));

        let colorIndex = 0;
        return segments.map((seg, idx) => {
            if (seg.isSpace) {
                return <span key={idx}>{seg.text}</span>;
            }
            const color = gradientColors[Math.min(colorIndex, gradientColors.length - 1)];
            // Apply opacity via styles too
            colorIndex++;
            return <span key={idx} style={{ color }}>{seg.text}</span>;
        });
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(generatedCode);
        // Simple alert or toast could go here
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in text-center md:text-left">
            <div className="flex items-center gap-4 border-b border-border pb-6">
                <Palette className="w-10 h-10 text-accent-primary" />
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                        Text Gradient Generator
                    </h1>
                    <p className="text-text-muted">Create beautiful colored text for in-game chat</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Controls */}
                <div className="space-y-6">
                    <Card>
                        <h2 className="font-semibold mb-4 text-accent-primary">Settings</h2>
                        <div className="space-y-4">
                            <Input
                                label="Text to color"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                helperText="Max 280 characters in the final output"
                            />

                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium text-text-muted">Gradient Mode</label>
                                <div className="flex bg-bg-input rounded-lg p-1 border border-border">
                                    <button
                                        onClick={() => setMode('chars')}
                                        className={cn(
                                            "flex-1 py-1.5 text-sm rounded-md transition-all",
                                            mode === 'chars' ? "bg-accent-primary text-black font-bold shadow-glow" : "text-text-muted hover:text-text-primary"
                                        )}
                                    >
                                        By Character
                                    </button>
                                    <button
                                        onClick={() => setMode('words')}
                                        className={cn(
                                            "flex-1 py-1.5 text-sm rounded-md transition-all",
                                            mode === 'words' ? "bg-accent-primary text-black font-bold shadow-glow" : "text-text-muted hover:text-text-primary"
                                        )}
                                    >
                                        By Word
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center justify-between pt-2">
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium">Force Short Hex</span>
                                    <span className="text-[10px] text-text-muted">Round all colors to 3-digit hex (#RGB) to save characters</span>
                                </div>
                                <button
                                    onClick={() => setUseShortHex(!useShortHex)}
                                    className={cn(
                                        "w-10 h-5 rounded-full transition-colors relative",
                                        useShortHex ? "bg-accent-primary" : "bg-bg-input border border-border"
                                    )}
                                >
                                    <div className={cn(
                                        "absolute top-1 w-3 h-3 rounded-full transition-all",
                                        useShortHex ? "right-1 bg-black" : "left-1 bg-text-muted"
                                    )} />
                                </button>
                            </div>
                        </div>
                    </Card>

                    <Card>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="font-semibold text-accent-primary">Colors</h2>
                            <Button size="sm" variant="outline" onClick={addMiddleColor} className="h-8 text-xs gap-1">
                                <Plus className="w-3 h-3" /> Add Stop
                            </Button>
                        </div>

                        <div className="space-y-3">
                            {/* Start */}
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-3">
                                    <input
                                        type="color"
                                        value={startColor}
                                        onChange={(e) => setStartColor(e.target.value)}
                                        className="w-10 h-10 rounded cursor-pointer bg-transparent border-none p-0"
                                    />
                                    <Input
                                        value={startColor}
                                        onChange={(e) => setStartColor(e.target.value)}
                                        className="flex-1 font-mono"
                                    />
                                    <span className="text-xs text-text-muted w-16 text-right font-bold">Start</span>
                                </div>
                                <div className="flex items-center gap-3 px-1">
                                    <input
                                        type="range"
                                        min="0"
                                        max="255"
                                        value={startAlpha}
                                        onChange={(e) => setStartAlpha(parseInt(e.target.value))}
                                        className="flex-1 h-1.5 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary"
                                    />
                                    <span className="text-[10px] font-mono w-8 text-right text-text-muted">{Math.round((startAlpha / 255) * 100)}%</span>
                                </div>
                            </div>

                            {/* Middle */}
                            {middleColors.map((c) => (
                                <div key={c.id} className="flex flex-col gap-3 p-3 rounded-lg bg-bg-secondary/30 border border-border/50">
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="color"
                                            value={c.hex}
                                            onChange={(e) => updateMiddleColor(c.id, e.target.value)}
                                            className="w-10 h-10 rounded cursor-pointer bg-transparent border-none p-0"
                                        />
                                        <Input
                                            value={c.hex}
                                            onChange={(e) => updateMiddleColor(c.id, e.target.value)}
                                            className="flex-1 font-mono"
                                        />
                                        <button
                                            onClick={() => removeMiddleColor(c.id)}
                                            className="w-8 flex justify-end text-red-400 hover:text-red-300 transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-3 px-1">
                                        <input
                                            type="range"
                                            min="0"
                                            max="255"
                                            value={c.alpha}
                                            onChange={(e) => updateMiddleAlpha(c.id, parseInt(e.target.value))}
                                            className="flex-1 h-1.5 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary"
                                        />
                                        <span className="text-[10px] font-mono w-8 text-right text-text-muted">{Math.round((c.alpha / 255) * 100)}%</span>
                                    </div>
                                </div>
                            ))}

                            {/* End */}
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-3">
                                    <input
                                        type="color"
                                        value={endColor}
                                        onChange={(e) => setEndColor(e.target.value)}
                                        className="w-10 h-10 rounded cursor-pointer bg-transparent border-none p-0"
                                    />
                                    <Input
                                        value={endColor}
                                        onChange={(e) => setEndColor(e.target.value)}
                                        className="flex-1 font-mono"
                                    />
                                    <span className="text-xs text-text-muted w-16 text-right font-bold">End</span>
                                </div>
                                <div className="flex items-center gap-3 px-1">
                                    <input
                                        type="range"
                                        min="0"
                                        max="255"
                                        value={endAlpha}
                                        onChange={(e) => setEndAlpha(parseInt(e.target.value))}
                                        className="flex-1 h-1.5 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary"
                                    />
                                    <span className="text-[10px] font-mono w-8 text-right text-text-muted">{Math.round((endAlpha / 255) * 100)}%</span>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* Preview & Output */}
                <div className="space-y-6">
                    <Card>
                        <h2 className="font-semibold mb-4 text-accent-primary">Preview</h2>
                        <div className="min-h-[100px] flex items-center justify-center bg-bg-secondary rounded-lg border border-border p-6 text-xl md:text-2xl font-bold break-all">
                            <div>{renderPreview()}</div>
                        </div>
                    </Card>

                    <Card>
                        <h2 className="font-semibold mb-4 text-accent-primary">Generated Code</h2>
                        <textarea
                            readOnly
                            value={generatedCode}
                            className={cn(
                                "w-full h-32 bg-bg-input border rounded-lg p-3 font-mono text-sm text-text-primary focus:border-accent-primary outline-none resize-none transition-colors",
                                generatedCode.length > 280 ? "border-red-500" : "border-border"
                            )}
                        />
                        <div className="flex justify-between items-center mt-2">
                            <span className={cn(
                                "text-xs font-bold",
                                generatedCode.length > 280 ? "text-red-500 animate-pulse" : "text-text-muted"
                            )}>
                                {generatedCode.length} / 280 characters
                            </span>
                            {generatedCode.length > 280 && (
                                <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Too long for chat!</span>
                            )}
                        </div>
                        <div className="mt-4 flex justify-end">
                            <Button onClick={copyToClipboard} className="gap-2">
                                <Copy className="w-4 h-4" /> Copy Code
                            </Button>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
