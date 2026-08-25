import { useState, useMemo, useEffect } from 'react';
import { Card } from '../components/UI/Card';
import { Input } from '../components/UI/Input';
import { Button } from '../components/UI/Button';
import { Search, Image as ImageIcon, Download, X, Maximize2, ExternalLink, Columns, Layers, Hash, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatVersion } from '../lib/formatVersion';
import { useGameDataContext } from '../context/GameDataContext';

type DiffStatus = 'added' | 'removed' | 'changed' | null;

export default function Gallery() {
    const { versions, selectedVersion } = useGameDataContext();
    const [searchTerm, setSearchTerm] = useState('');
    const [textures, setTextures] = useState<string[]>([]);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [compareVersion, setCompareVersion] = useState<string | null>(null);
    const [showOnlyChanges, setShowOnlyChanges] = useState(false);
    const [md5Manifest, setMd5Manifest] = useState<Record<string, Record<string, string>>>({});

    // Subtraction states
    const [isDiffing, setIsDiffing] = useState(false);
    const [diffImageUrl, setDiffImageUrl] = useState<string | null>(null);
    const [showDiff, setShowDiff] = useState(false);
    const [diffColor, setDiffColor] = useState('#ff00ff'); // Default Magenta
    const [mobileView, setMobileView] = useState<'active' | 'compare'>('active');

    const hexToRgb = (hex: string) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 255, g: 0, b: 255 };
    };

    useEffect(() => {
        async function fetchManifests() {
            setLoading(true);

            // Fetch Texture list
            try {
                const res = await fetch(`${import.meta.env.BASE_URL}parsed_configs/TextureManifest.json`);
                if (res.ok) {
                    const contentType = res.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        const data = await res.json();
                        setTextures(data);
                    } else {
                        console.warn("TextureManifest.json returned non-JSON content", contentType);
                    }
                }
            } catch (e) {
                console.error("Failed to load TextureManifest.json", e);
            }

            // Try to fetch MD5 Manifest if it exists
            try {
                const md5Res = await fetch(`${import.meta.env.BASE_URL}parsed_configs/TextureMD5Manifest.json`);
                if (md5Res.ok) {
                    const contentType = md5Res.headers.get("content-type");
                    if (contentType && contentType.includes("application/json")) {
                        const data = await md5Res.json();
                        setMd5Manifest(data);
                    }
                }
            } catch (e) {
                console.debug("TextureMD5Manifest.json not found or invalid", e);
            } finally {
                setLoading(false);
            }
        }
        fetchManifests();
    }, []);

    const activeVersion = selectedVersion || versions[0];

    const filteredTextures = useMemo(() => {
        let list = textures;
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            list = list.filter(t => t.toLowerCase().includes(lower));
        }

        // Only when we have the manifests for the active version
        if (md5Manifest[activeVersion]) {
            if (showOnlyChanges && compareVersion && md5Manifest[compareVersion]) {
                // Filtra solo le differenze (aggiunte, rimosse o modificate)
                list = list.filter(t => {
                    const hashA = md5Manifest[activeVersion][t];
                    const hashB = md5Manifest[compareVersion][t];
                    return hashA !== hashB;
                });
            } else {
                // Comportamento normale: mostra solo le texture presenti nella versione attiva
                list = list.filter(t => !!md5Manifest[activeVersion][t]);
            }
        }

        return list;
    }, [searchTerm, textures, showOnlyChanges, compareVersion, md5Manifest, activeVersion]);

    const handleDownload = (filename: string, version: string) => {
        const url = `${import.meta.env.BASE_URL}Texture2D/${version}/${filename}`;
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const computeImageDiff = async (imgName: string, v1: string, v2: string, color: string) => {
        setIsDiffing(true);
        // Don't reset showDiff here to allow seamless color change

        const url1 = `${import.meta.env.BASE_URL}Texture2D/${v1}/${imgName}`;
        const url2 = `${import.meta.env.BASE_URL}Texture2D/${v2}/${imgName}`;

        try {
            const loadImage = (url: string): Promise<HTMLImageElement> => {
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.onload = () => resolve(img);
                    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
                    img.src = url;
                });
            };

            const [img1, img2] = await Promise.all([loadImage(url1), loadImage(url2)]);

            const canvas = document.createElement('canvas');
            const width = Math.max(img1.width, img2.width);
            const height = Math.max(img1.height, img2.height);
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Draw first image
            ctx.drawImage(img1, 0, 0);
            const data1 = ctx.getImageData(0, 0, width, height);

            // Draw second image on a temporary canvas to get its data
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const tempCtx = tempCanvas.getContext('2d');
            if (!tempCtx) return;
            tempCtx.drawImage(img2, 0, 0);
            const data2 = tempCtx.getImageData(0, 0, width, height);

            // Create result data (transparent mask with highlight color)
            const resultData = ctx.createImageData(width, height);
            const { r, g, b } = hexToRgb(color);

            for (let i = 0; i < data1.data.length; i += 4) {
                const rDiff = Math.abs(data1.data[i] - data2.data[i]);
                const gDiff = Math.abs(data1.data[i + 1] - data2.data[i + 1]);
                const bDiff = Math.abs(data1.data[i + 2] - data2.data[i + 2]);
                const aDiff = Math.abs(data1.data[i + 3] - data2.data[i + 3]);

                if (rDiff > 0 || gDiff > 0 || bDiff > 0 || aDiff > 0) {
                    resultData.data[i] = r;
                    resultData.data[i + 1] = g;
                    resultData.data[i + 2] = b;
                    resultData.data[i + 3] = 255;
                } else {
                    resultData.data[i + 3] = 0; // Fully transparent where no diff
                }
            }

            ctx.putImageData(resultData, 0, 0);
            setDiffImageUrl(canvas.toDataURL());
            setShowDiff(true);
        } catch (error) {
            console.error("Error computing image diff:", error);
        } finally {
            setIsDiffing(false);
        }
    };

    if (loading || !activeVersion) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent uppercase tracking-tight">
                        Texture Gallery
                    </h1>
                    <p className="text-text-secondary mt-1 text-sm font-medium">
                        Browse and compare game assets across different versions.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative w-full md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                        <Input
                            placeholder="Search textures"
                            className="pl-9 h-10"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center bg-bg-secondary/40 p-1 rounded-lg border border-border">
                        <select
                            value={compareVersion || ''}
                            onChange={(e) => {
                                setCompareVersion(e.target.value || null);
                                if (!e.target.value) setShowOnlyChanges(false);
                            }}
                            className="bg-transparent text-xs font-bold text-text-secondary px-2 py-1 outline-none cursor-pointer hover:text-white transition-colors"
                        >
                            <option value="">Compare Version</option>
                            {/* Filtriamo mostrando solo le versioni diverse da activeVersion E che hanno il manifest md5 */}
                            {versions
                                .filter(v => v !== activeVersion && md5Manifest[v] && Object.keys(md5Manifest[v]).length > 0)
                                .map(v => (
                                    <option key={v} value={v}>{formatVersion(v)}</option>
                                ))}
                        </select>
                        {compareVersion && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowOnlyChanges(!showOnlyChanges)}
                                className={cn(
                                    "h-7 px-2 text-[10px] font-black uppercase tracking-widest gap-1.5",
                                    showOnlyChanges ? "text-accent-primary bg-accent-primary/10" : "text-text-muted"
                                )}
                            >
                                <Hash size={12} />
                                Diff Only
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                {filteredTextures.map((texture) => {
                    const hashA = md5Manifest[activeVersion]?.[texture];
                    const hashB = compareVersion ? md5Manifest[compareVersion]?.[texture] : null;

                    let diffStatus: DiffStatus = null;
                    if (compareVersion && hashA !== hashB) {
                        if (hashA && !hashB) diffStatus = 'added';
                        else if (!hashA && hashB) diffStatus = 'removed';
                        else diffStatus = 'changed';
                    }

                    // A removed image has no source in the active version, so fall back to the compared one
                    const previewVersion = diffStatus === 'removed' && compareVersion ? compareVersion : activeVersion;

                    return (
                        <Card
                            key={texture}
                            className={cn(
                                "group relative flex flex-col p-2 bg-bg-secondary/40 border-border/50 hover:border-accent-primary/50 transition-all cursor-pointer overflow-hidden",
                                diffStatus === 'changed' && "border-yellow-500/50 ring-1 ring-yellow-500/20",
                                diffStatus === 'added' && "border-green-500/50 ring-1 ring-green-500/20",
                                diffStatus === 'removed' && "border-red-500/50 ring-1 ring-red-500/20 opacity-80 hover:opacity-100"
                            )}
                            onClick={() => setSelectedImage(texture)}
                        >
                            <div className="aspect-square rounded-md overflow-hidden bg-bg-primary/50 flex items-center justify-center p-2 relative">
                                <img
                                    src={`${import.meta.env.BASE_URL}Texture2D/${previewVersion}/${encodeURIComponent(texture)}`}
                                    alt={texture}
                                    loading="lazy"
                                    className="max-w-full max-h-full object-contain pixelated transition-transform group-hover:scale-110"
                                    onError={(e) => {
                                        const img = e.target as HTMLImageElement;
                                        if (img.src.includes(`/${previewVersion}/`)) {
                                            img.src = `${import.meta.env.BASE_URL}Texture2D/${encodeURIComponent(texture)}`;
                                        } else {
                                            img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjIiIHJ5PSIyIi8+PGNpcmNsZSBjeD0iOC41IiBjeT0iOC41IiByPSIxLjUiLz48cG9seWdvbiBwb2ludHM9IjIxIDE1IDE2IDEwIDUgMjEgMjEgMjEgMjEiLz48L3N2Zz4=';
                                        }
                                    }}
                                />
                                {diffStatus && (
                                    <div className={cn(
                                        "absolute top-1 right-1 text-[8px] font-black px-1 rounded shadow-lg uppercase",
                                        diffStatus === 'added' ? "bg-green-500 text-black" :
                                            diffStatus === 'removed' ? "bg-red-500 text-white" :
                                                "bg-yellow-500 text-black"
                                    )}>
                                        {diffStatus}
                                    </div>
                                )}
                            </div>
                            <div className={cn("mt-2 text-[10px] font-medium whitespace-nowrap overflow-hidden text-clip px-1", diffStatus === 'removed' ? "text-red-400/80 line-through" : "text-text-muted")} title={texture}>
                                {texture}
                            </div>

                            {/* Hover Overlay */}
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                                <div className="flex gap-2">
                                    <Button size="sm" variant="secondary" className="h-8 w-8 rounded-full p-0" onClick={(e) => { e.stopPropagation(); setSelectedImage(texture); }}>
                                        <Maximize2 size={14} />
                                    </Button>
                                    <Button size="sm" variant="primary" className="h-8 w-8 rounded-full p-0" onClick={(e) => { e.stopPropagation(); handleDownload(texture, previewVersion); }}>
                                        <Download size={14} />
                                    </Button>
                                </div>
                                <span className="text-[10px] font-black text-white uppercase tracking-widest px-2 text-center whitespace-nowrap overflow-hidden text-clip w-full">
                                    {texture}
                                </span>
                            </div>
                        </Card>
                    );
                })}
            </div>

            {/* Modal for detail view / comparison */}
            {selectedImage && (
                <div style={{ margin: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-8 bg-black/90 animate-fade-in backdrop-blur-sm overflow-y-auto" onClick={() => { setSelectedImage(null); setShowDiff(false); setDiffImageUrl(null); }}>
                    <button
                        className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors p-2 z-[60]"
                        onClick={() => { setSelectedImage(null); setShowDiff(false); setDiffImageUrl(null); }}
                    >
                        <X size={32} />
                    </button>

                    <div className="w-full max-w-6xl flex flex-col gap-6" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                            <div className="min-w-0 text-center lg:text-left">
                                <h2 className="text-lg md:text-2xl font-black text-white uppercase tracking-tight whitespace-nowrap overflow-hidden text-clip px-2" title={selectedImage}>
                                    {selectedImage}
                                </h2>
                                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2 mt-1">
                                    <span className="text-[10px] font-bold text-text-muted uppercase bg-white/5 px-1.5 py-0.5 rounded">Version: {formatVersion(activeVersion)}</span>
                                    {compareVersion && <span className="text-[10px] font-bold text-accent-primary uppercase bg-accent-primary/10 px-1.5 py-0.5 rounded">vs {formatVersion(compareVersion)}</span>}
                                </div>
                            </div>
                            <div className="flex flex-col sm:flex-row items-center gap-3 px-2">
                                {compareVersion && md5Manifest[activeVersion]?.[selectedImage] && md5Manifest[compareVersion]?.[selectedImage] && (
                                    <div className="flex items-center gap-2 bg-bg-secondary/60 p-1.5 rounded-xl border border-white/10 shadow-lg">
                                        <div className="flex gap-1 px-2 border-r border-white/10 mr-0.5">
                                            {['#ff00ff', '#00ffff', '#39ff14', '#ff3131', '#faff00'].map(c => (
                                                <button
                                                    key={c}
                                                    className={cn(
                                                        "w-4 h-4 md:w-5 md:h-5 rounded-full border border-white/20 transition-transform hover:scale-125 active:scale-95",
                                                        diffColor === c && "ring-2 ring-white ring-offset-2 ring-offset-black scale-110"
                                                    )}
                                                    style={{ backgroundColor: c }}
                                                    onClick={() => {
                                                        setDiffColor(c);
                                                        computeImageDiff(selectedImage, activeVersion, compareVersion, c);
                                                    }}
                                                />
                                            ))}
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className={cn(
                                                "h-8 font-black uppercase tracking-widest gap-2 text-[10px] px-3",
                                                showDiff ? "bg-accent-primary text-black hover:bg-accent-primary/80" : "text-text-muted hover:text-white"
                                            )}
                                            onClick={() => {
                                                if (showDiff) setShowDiff(false);
                                                else if (diffImageUrl) setShowDiff(true);
                                                else computeImageDiff(selectedImage, activeVersion, compareVersion, diffColor);
                                            }}
                                            disabled={isDiffing}
                                        >
                                            {isDiffing ? (
                                                <RefreshCw size={14} className="animate-spin" />
                                            ) : (
                                                <Layers size={14} />
                                            )}
                                            <span className="hidden sm:inline">{showDiff ? "Diff On" : "Diff Off"}</span>
                                            <span className="sm:hidden">{showDiff ? "On" : "Off"}</span>
                                        </Button>
                                    </div>
                                )}
                                {md5Manifest[activeVersion]?.[selectedImage] && (
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        className="font-black uppercase tracking-widest gap-2 h-10 px-6 w-full sm:w-auto"
                                        onClick={() => handleDownload(selectedImage, activeVersion)}
                                    >
                                        <Download size={18} />
                                        <span>Download</span>
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Mobile Version Switcher */}
                        {compareVersion && (
                            <div className="flex md:hidden bg-bg-secondary/60 p-1 rounded-xl border border-white/10 self-center">
                                <button
                                    className={cn(
                                        "px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
                                        mobileView === 'active' ? "bg-white text-black shadow-lg" : "text-text-muted"
                                    )}
                                    onClick={() => setMobileView('active')}
                                >
                                    Active
                                </button>
                                <button
                                    className={cn(
                                        "px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
                                        mobileView === 'compare' ? "bg-accent-primary text-black shadow-lg" : "text-text-muted"
                                    )}
                                    onClick={() => setMobileView('compare')}
                                >
                                    Compare
                                </button>
                            </div>
                        )}

                        <div className={cn(
                            "grid gap-6 transition-all duration-300",
                            compareVersion ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
                        )}>
                            {/* Active Version Card */}
                            <Card className={cn(
                                "p-4 bg-bg-secondary/40 border-border/50 flex flex-col items-center gap-4",
                                !md5Manifest[activeVersion]?.[selectedImage] && "opacity-50",
                                compareVersion && mobileView === 'compare' && "hidden md:flex"
                            )}>
                                <div className="text-[10px] font-black text-text-muted uppercase tracking-widest bg-bg-input px-2 py-1 rounded">
                                    Version: {formatVersion(activeVersion)}
                                </div>
                                <div className="flex-1 w-full flex items-center justify-center bg-bg-primary/30 rounded-lg overflow-hidden p-4 border border-border/20 relative min-h-[300px] max-h-[60vh]">
                                    {md5Manifest[activeVersion]?.[selectedImage] ? (
                                        <div className="relative flex items-center justify-center w-full h-full">
                                            <img
                                                src={`${import.meta.env.BASE_URL}Texture2D/${activeVersion}/${selectedImage}`}
                                                className="pixelated max-w-full max-h-full object-contain"
                                                alt={selectedImage}
                                            />
                                            {showDiff && diffImageUrl && (
                                                <img
                                                    src={diffImageUrl}
                                                    className="pixelated absolute top-0 left-0 w-full h-full object-contain opacity-80 pointer-events-none"
                                                    alt="diff overlay"
                                                />
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-text-muted text-sm font-bold uppercase tracking-widest">Not in this version</span>
                                    )}
                                </div>
                                {md5Manifest[activeVersion]?.[selectedImage] && (
                                    <div className="font-mono text-[10px] text-text-muted bg-black/20 px-2 py-1 rounded flex items-center gap-2">
                                        <Hash size={10} /> {md5Manifest[activeVersion][selectedImage]}
                                    </div>
                                )}
                            </Card>

                            {/* Comparison Version Card */}
                            {compareVersion && (
                                <Card className={cn(
                                    "p-4 bg-bg-secondary/40 border-border/50 flex flex-col items-center gap-4 relative",
                                    !md5Manifest[compareVersion]?.[selectedImage] && "opacity-50",
                                    mobileView === 'active' && "hidden md:flex"
                                )}>
                                    <div className="text-[10px] font-black text-accent-primary uppercase tracking-widest bg-accent-primary/10 px-2 py-1 rounded">
                                        Comparison: {formatVersion(compareVersion)}
                                    </div>
                                    <div className="flex-1 w-full flex items-center justify-center bg-bg-primary/30 rounded-lg overflow-hidden p-4 border border-border/20 relative min-h-[300px] max-h-[60vh]">
                                        {md5Manifest[compareVersion]?.[selectedImage] ? (
                                            <div className="relative flex items-center justify-center w-full h-full">
                                                <img
                                                    src={`${import.meta.env.BASE_URL}Texture2D/${compareVersion}/${selectedImage}`}
                                                    className="pixelated max-w-full max-h-full object-contain"
                                                    alt={`${selectedImage} comp`}
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).style.display = 'none';
                                                    }}
                                                />
                                                {showDiff && diffImageUrl && (
                                                    <img
                                                        src={diffImageUrl}
                                                        className="pixelated absolute top-0 left-0 w-full h-full object-contain opacity-80 pointer-events-none"
                                                        alt="diff overlay"
                                                    />
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-text-muted text-sm font-bold uppercase tracking-widest">Not in this version</span>
                                        )}
                                    </div>
                                    {md5Manifest[compareVersion]?.[selectedImage] && (
                                        <div className="font-mono text-[10px] text-text-muted bg-black/20 px-2 py-1 rounded flex items-center gap-2">
                                            <Hash size={10} /> {md5Manifest[compareVersion][selectedImage]}
                                        </div>
                                    )}

                                    {/* Etichette differenze modale */}
                                    {md5Manifest[activeVersion]?.[selectedImage] !== md5Manifest[compareVersion]?.[selectedImage] && (
                                        <div className={cn(
                                            "absolute top-4 right-4 text-[10px] font-black px-2 py-1 rounded shadow-xl uppercase",
                                            md5Manifest[activeVersion]?.[selectedImage] && !md5Manifest[compareVersion]?.[selectedImage] ? "bg-green-500 text-black" :
                                                !md5Manifest[activeVersion]?.[selectedImage] && md5Manifest[compareVersion]?.[selectedImage] ? "bg-red-500 text-white" :
                                                    "bg-yellow-500 text-black"
                                        )}>
                                            {md5Manifest[activeVersion]?.[selectedImage] && !md5Manifest[compareVersion]?.[selectedImage] ? "Added" :
                                                !md5Manifest[activeVersion]?.[selectedImage] && md5Manifest[compareVersion]?.[selectedImage] ? "Removed" :
                                                    "Difference Detected"}
                                        </div>
                                    )}
                                </Card>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}