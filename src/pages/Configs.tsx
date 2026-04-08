import { useState, useEffect, useMemo } from 'react';
import { Card } from '../components/UI/Card';
import { Input } from '../components/UI/Input';
import { cn } from '../lib/utils';
import { Search, FileJson, FolderOpen, RefreshCw, Copy, Download, Check } from 'lucide-react';
import { Button } from '../components/UI/Button';

export default function Configs() {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [configManifest, setConfigManifest] = useState<Record<string, string[]>>({});
    const [configFiles, setConfigFiles] = useState<string[]>([]);

    // Versioning State
    const [isCompareMode, setIsCompareMode] = useState(false);
    const [baseVersion, setBaseVersion] = useState<string>('');
    const [targetVersion, setTargetVersion] = useState<string>('');
    const [versions, setVersions] = useState<string[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<string>('');

    // Cache for all files content { [version]: { [filename]: JSONstring } }
    const [multiFileCache, setMultiFileCache] = useState<Record<string, Record<string, string>>>({});
    const [isLoadingAll, setIsLoadingAll] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [copied, setCopied] = useState(false);

    // Initial fetch of versions and manifest
    useEffect(() => {
        async function fetchData() {
            try {
                const [versionsRes, manifestRes] = await Promise.all([
                    fetch('./parsed_configs/versions.json'),
                    fetch('./parsed_configs/config_manifest.json')
                ]);

                if (versionsRes.ok) {
                    const v = await versionsRes.json();
                    v.sort((a: string, b: string) => b.localeCompare(a));
                    setVersions(v);
                    if (v.length > 0) {
                        setSelectedVersion(v[0]);
                        setTargetVersion(v[0]);
                        if (v.length > 1) setBaseVersion(v[1]);
                        else setBaseVersion(v[0]);
                    }
                }

                if (manifestRes.ok) {
                    const manifest = await manifestRes.json();
                    setConfigManifest(manifest);
                }
            } catch (e) {
                console.error("Failed to load initial data", e);
            }
        }
        fetchData();
    }, []);

    // Selection changes
    useEffect(() => {
        if (!isCompareMode) {
            setTargetVersion(selectedVersion);
        }
    }, [selectedVersion, isCompareMode]);

    // Update config files list when version or manifest changes
    useEffect(() => {
        const v = isCompareMode ? targetVersion : selectedVersion;
        if (v && configManifest[v]) {
            setConfigFiles(configManifest[v]);
        } else {
            setConfigFiles([]);
        }
    }, [selectedVersion, targetVersion, isCompareMode, configManifest]);

    // Background fetch for comparison or single version
    useEffect(() => {
        const versionsToFetch = isCompareMode ? [baseVersion, targetVersion] : [selectedVersion];
        const filteredVersions = versionsToFetch.filter(v => v && configManifest[v]);

        if (filteredVersions.length === 0) return;

        const fetchAll = async () => {
            setIsLoadingAll(true);
            setLoadingProgress(0);

            const newMultiCache = { ...multiFileCache };
            let totalFiles = 0;
            filteredVersions.forEach(v => {
                if (configManifest[v] && !newMultiCache[v]) {
                    totalFiles += configManifest[v].length;
                }
            });

            if (totalFiles === 0) {
                setIsLoadingAll(false);
                return;
            }

            let loaded = 0;
            try {
                for (const v of filteredVersions) {
                    if (newMultiCache[v]) continue;
                    
                    const cache: Record<string, string> = {};
                    const files = configManifest[v];
                    
                    await Promise.all(files.map(async (fileName: string) => {
                        try {
                            const res = await fetch(`./parsed_configs/${v}/${fileName}`);
                            if (res.ok) {
                                const json = await res.json();
                                cache[fileName] = JSON.stringify(json, null, 2);
                            }
                        } catch (e) {
                            console.error(`Failed to load ${fileName} for ${v}`, e);
                        } finally {
                            loaded++;
                            setLoadingProgress(Math.round((loaded / totalFiles) * 100));
                        }
                    }));
                    newMultiCache[v] = cache;
                }
                setMultiFileCache(newMultiCache);
            } catch (err) {
                console.error("Global fetch error", err);
            } finally {
                setIsLoadingAll(false);
            }
        };

        fetchAll();
    }, [selectedVersion, baseVersion, targetVersion, isCompareMode, configManifest]);

    // Filter files based on Global Search (Name OR Content)
    const filteredFiles = useMemo(() => {
        if (!searchTerm) return configFiles;

        const lowerTerm = searchTerm.toLowerCase();
        const v = isCompareMode ? targetVersion : selectedVersion;
        const cache = multiFileCache[v] || {};

        return configFiles.filter(fileName => {
            if (fileName.toLowerCase().includes(lowerTerm)) return true;
            const content = cache[fileName];
            if (content && content.toLowerCase().includes(lowerTerm)) return true;
            return false;
        });
    }, [searchTerm, multiFileCache, configFiles, isCompareMode, targetVersion, selectedVersion]);

    // Helper to render content with highlighted search terms
    const renderHighlightedContent = (content: string, term: string) => {
        if (!term) return content;

        // Escape regex special characters
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const parts = content.split(new RegExp(`(${escapedTerm})`, 'gi'));

        return parts.map((part, i) =>
            part.toLowerCase() === term.toLowerCase() ? (
                <span key={i} className="bg-yellow-500/40 text-yellow-100 font-bold px-0.5 rounded border border-yellow-500/50">
                    {part}
                </span>
            ) : (
                part
            )
        );
    };

    // Diff Logic for whole manifest
    const comparison = useMemo(() => {
        if (!isCompareMode || !baseVersion || !targetVersion || !configManifest[baseVersion] || !configManifest[targetVersion]) {
            return null;
        }

        const baseFiles = configManifest[baseVersion];
        const targetFiles = configManifest[targetVersion];

        const added = targetFiles.filter(f => !baseFiles.includes(f));
        const removed = baseFiles.filter(f => !targetFiles.includes(f));
        const remaining = targetFiles.filter(f => baseFiles.includes(f));

        // Modified files are those in both where content differs
        const modified = remaining.filter(f => {
            const baseContent = multiFileCache[baseVersion]?.[f];
            const targetContent = multiFileCache[targetVersion]?.[f];
            return baseContent && targetContent && baseContent !== targetContent;
        });

        return { added, removed, modified };
    }, [isCompareMode, baseVersion, targetVersion, configManifest, multiFileCache]);

    // All relevant files to show in sidebar
    const displayFiles = useMemo(() => {
        if (!isCompareMode) return filteredFiles;
        
        // In compare mode, we show files from target version, but also those removed from base
        const baseFiles = configManifest[baseVersion] || [];
        const targetFiles = configManifest[targetVersion] || [];
        const all = Array.from(new Set([...baseFiles, ...targetFiles])).sort();

        if (!searchTerm) return all;
        const lowerTerm = searchTerm.toLowerCase();
        return all.filter(f => {
            if (f.toLowerCase().includes(lowerTerm)) return true;
            if (multiFileCache[targetVersion]?.[f]?.toLowerCase().includes(lowerTerm)) return true;
            if (multiFileCache[baseVersion]?.[f]?.toLowerCase().includes(lowerTerm)) return true;
            return false;
        });
    }, [isCompareMode, filteredFiles, baseVersion, targetVersion, configManifest, searchTerm, multiFileCache]);

    // Detailed Diff Legend
    const DiffLegend = () => (
        <div className="flex flex-wrap items-center gap-4 px-4 py-2 bg-bg-secondary/30 border-b border-border text-[10px] font-bold uppercase tracking-wider text-text-muted">
            <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 bg-green-500/20 border border-green-500/50 rounded-sm" />
                <span>Added / New</span>
            </div>
            <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 bg-red-500/20 border border-red-500/50 rounded-sm" />
                <span className="line-through">Removed / Deleted</span>
            </div>
            <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 bg-blue-500/20 border border-blue-500/50 rounded-sm" />
                <span>Modified</span>
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-accent-primary opacity-70">Old line: </span>
                <span className="text-red-400">Red</span>
                <span className="mx-1">|</span>
                <span className="text-accent-primary opacity-70">New line: </span>
                <span className="text-green-400">Green</span>
            </div>
        </div>
    );

    // Simple diff renderer (Line by line)
    const renderDiff = (file: string) => {
        const base = multiFileCache[baseVersion]?.[file] || "";
        const target = multiFileCache[targetVersion]?.[file] || "";

        if (comparison?.added.includes(file)) {
            return (
                <div className="space-y-0.5">
                    {target.split('\n').map((line, i) => (
                        <div key={i} className="bg-green-500/10 text-green-300 px-2 font-mono text-xs flex">
                            <span className="opacity-50 mr-4 select-none w-10 shrink-0 text-right">{i + 1}</span>
                            <span className="whitespace-pre truncate">+ {line}</span>
                        </div>
                    ))}
                </div>
            );
        }

        if (comparison?.removed.includes(file)) {
            return (
                <div className="space-y-0.5">
                    {base.split('\n').map((line, i) => (
                        <div key={i} className="bg-red-500/10 text-red-300 px-2 font-mono text-xs flex">
                            <span className="opacity-50 mr-4 select-none w-10 shrink-0 text-right">{i + 1}</span>
                            <span className="whitespace-pre truncate line-through">- {line}</span>
                        </div>
                    ))}
                </div>
            );
        }

        const baseLines = base.split('\n');
        const targetLines = target.split('\n');
        
        // Slightly smarter line-by-line diff
        const maxLines = Math.max(baseLines.length, targetLines.length);
        const diffRows = [];

        for (let i = 0; i < maxLines; i++) {
            const bLine = baseLines[i];
            const tLine = targetLines[i];

            if (bLine === tLine) {
                diffRows.push(
                    <div key={`same-${i}`} className="px-2 font-mono text-xs text-text-secondary flex">
                        <span className="opacity-30 mr-4 select-none w-10 shrink-0 text-right">{i + 1}</span>
                        <span className="whitespace-pre truncate">  {tLine}</span>
                    </div>
                );
            } else {
                // Show removal if base has it
                if (bLine !== undefined) {
                    diffRows.push(
                        <div key={`rem-${i}`} className="bg-red-500/10 text-red-300 px-2 font-mono text-xs flex animate-in fade-in slide-in-from-left-1">
                            <span className="opacity-50 mr-4 select-none w-10 shrink-0 text-right">{i + 1}</span>
                            <span className="whitespace-pre truncate">- {bLine}</span>
                        </div>
                    );
                }
                // Show addition if target has it
                if (tLine !== undefined) {
                    diffRows.push(
                        <div key={`add-${i}`} className="bg-green-500/10 text-green-300 px-2 font-mono text-xs flex animate-in fade-in slide-in-from-right-1">
                            <span className="opacity-50 mr-4 select-none w-10 shrink-0 text-right">{i + 1}</span>
                            <span className="whitespace-pre truncate">+ {tLine}</span>
                        </div>
                    );
                }
            }
        }
        
        return <div className="space-y-0.5">{diffRows}</div>;
    };

    const handleCopy = async () => {
        const file = selectedFile;
        if (!file) return;
        const v = isCompareMode ? targetVersion : selectedVersion;
        const content = multiFileCache[v]?.[file];
        if (!content) return;

        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy!', err);
        }
    };

    const handleDownload = () => {
        const file = selectedFile;
        if (!file) return;
        const v = isCompareMode ? targetVersion : selectedVersion;
        const content = multiFileCache[v]?.[file];
        if (!content) return;

        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const getFileStatus = (file: string) => {
        if (!isCompareMode || !comparison) return null;
        if (comparison.added.includes(file)) return <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-bold">NEW</span>;
        if (comparison.removed.includes(file)) return <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold">DEL</span>;
        if (comparison.modified.includes(file)) return <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-bold">MOD</span>;
        return null;
    };

    return (
        <div className="h-[calc(100vh-8rem)] flex flex-col md:flex-row gap-6 animate-fade-in">
            {/* Sidebar: File List */}
            <Card className="md:w-96 flex flex-col p-0 overflow-hidden h-full">
                <div className="p-4 border-b border-border bg-bg-secondary/50 space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <FolderOpen className="w-5 h-5 text-accent-primary" />
                            Configs
                            <span className="text-xs font-normal text-text-muted bg-bg-input px-2 py-0.5 rounded-full">
                                {displayFiles.length}
                            </span>
                        </h2>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            className={cn("h-7 px-2 text-[10px] font-black uppercase tracking-widest", isCompareMode && "bg-accent-primary/20 border-accent-primary")}
                            onClick={() => setIsCompareMode(!isCompareMode)}
                        >
                            {isCompareMode ? "Exit Compare" : "Compare"}
                        </Button>
                    </div>

                    {/* Version Selector */}
                    {versions.length > 0 && (
                        <div className="space-y-2">
                            {isCompareMode ? (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest ml-1">Base (Old)</label>
                                        <select
                                            value={baseVersion}
                                            onChange={(e) => setBaseVersion(e.target.value)}
                                            className="w-full bg-bg-input border border-border rounded-md px-2 py-1 text-[11px] text-text-primary focus:border-accent-primary outline-none appearance-none cursor-pointer"
                                        >
                                            {versions.map(v => (
                                                <option key={v} value={v} disabled={v === targetVersion}>
                                                    {v}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-blue-400 uppercase tracking-widest ml-1">Target (New)</label>
                                        <select
                                            value={targetVersion}
                                            onChange={(e) => setTargetVersion(e.target.value)}
                                            className="w-full bg-bg-input border border-blue-500/30 rounded-md px-2 py-1 text-[11px] text-text-primary focus:border-accent-primary outline-none appearance-none cursor-pointer"
                                        >
                                            {versions.map(v => (
                                                <option key={v} value={v} disabled={v === baseVersion}>
                                                    {v} {v === versions[0] ? '(Latest)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            ) : (
                                <div className="relative">
                                    <select
                                        value={selectedVersion}
                                        onChange={(e) => setSelectedVersion(e.target.value)}
                                        className="w-full bg-bg-input border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:border-accent-primary outline-none appearance-none cursor-pointer"
                                    >
                                        {versions.map(v => (
                                            <option key={v} value={v} className="bg-bg-card">
                                                Version: {v} {v === versions[0] ? '(Latest)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                        <Input
                            placeholder="Global Search..."
                            className="pl-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {isLoadingAll && (
                        <div className="mt-2 text-xs text-text-muted flex items-center gap-2">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Indexing... {loadingProgress}%
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {displayFiles.map(file => {
                        const v = isCompareMode ? targetVersion : selectedVersion;
                        const hasContent = multiFileCache[v]?.[file] || (isCompareMode && multiFileCache[baseVersion]?.[file]);
                        
                        return (
                            <button
                                key={file}
                                onClick={() => setSelectedFile(file)}
                                className={cn(
                                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between group",
                                    selectedFile === file
                                        ? "bg-gradient-to-r from-accent-primary/20 to-transparent text-accent-primary border border-accent-primary/20 shadow-sm"
                                        : "text-text-secondary hover:bg-white/5 hover:text-text-primary"
                                )}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <FileJson className={cn("w-4 h-4 shrink-0 opacity-70", selectedFile === file && "text-accent-primary")} />
                                    <div className="flex flex-col overflow-hidden text-left">
                                        <span className="truncate">{file.replace('.json', '')}</span>
                                        {!hasContent && <span className="text-[10px] text-text-muted italic">Loading...</span>}
                                    </div>
                                </div>
                                {getFileStatus(file)}
                            </button>
                        );
                    })}
                    {displayFiles.length === 0 && (
                        <div className="p-4 text-center text-sm text-text-muted">
                            No files found matching "{searchTerm}"
                        </div>
                    )}
                </div>
            </Card>

            {/* Main Content: JSON Viewer or Diff Viewer */}
            <Card className="flex-1 overflow-hidden flex flex-col h-full p-0">
                {selectedFile ? (
                    <>
                        <div className="p-4 border-b border-border bg-bg-secondary/50 flex items-center justify-between">
                            <div className="flex flex-col min-w-0">
                                <h3 className="font-semibold text-text-primary flex items-center gap-2">
                                    <FileJson className="w-5 h-5 text-accent-tertiary" />
                                    <span className="truncate">{selectedFile}</span>
                                </h3>
                                {isCompareMode && (
                                    <div className="text-[10px] flex gap-2 mt-0.5">
                                        <span className="text-text-muted">Comparing: <span className="text-text-primary font-mono">{baseVersion}</span></span>
                                        <span className="text-text-muted">→ <span className="text-blue-400 font-mono">{targetVersion}</span></span>
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {!isCompareMode && multiFileCache[selectedVersion]?.[selectedFile] && (
                                    <span className="text-xs text-text-muted mr-4 hidden sm:inline-block">
                                        {(JSON.parse(multiFileCache[selectedVersion][selectedFile]) as any).length || Object.keys(JSON.parse(multiFileCache[selectedVersion][selectedFile])).length} entries
                                    </span>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleCopy}
                                    title="Copy content"
                                    className="h-8 w-8 p-0"
                                >
                                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleDownload}
                                    title="Download JSON"
                                    className="h-8 w-8 p-0"
                                >
                                    <Download className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto bg-bg-primary/50 relative custom-scrollbar flex flex-col">
                            {isCompareMode ? (
                                <>
                                    <DiffLegend />
                                    <div className="p-4 flex-1">
                                        {renderDiff(selectedFile)}
                                    </div>
                                </>
                            ) : (
                                <div className="p-6">
                                    {!multiFileCache[selectedVersion]?.[selectedFile] ? (
                                        <div className="absolute inset-0 flex items-center justify-center bg-bg-card/50 backdrop-blur-sm z-10">
                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary"></div>
                                        </div>
                                    ) : (
                                        <div className="text-sm font-mono text-text-secondary leading-relaxed whitespace-pre-wrap break-all">
                                            <pre className="font-inherit">
                                                {renderHighlightedContent(multiFileCache[selectedVersion][selectedFile], searchTerm)}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-text-muted gap-4">
                        <div className="p-6 bg-bg-secondary rounded-full border border-border/50">
                            <FolderOpen className="w-16 h-16 opacity-20" />
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-text-primary">Configuration Explorer</p>
                            <p className="text-sm">Select a file from the sidebar to inspect its content{isCompareMode ? " or view changes" : ""}.</p>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
}
