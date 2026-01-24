import { useState, useEffect, useMemo } from 'react';
import { Card } from '../components/UI/Card';
import { Input } from '../components/UI/Input';
import { cn } from '../lib/utils';
import { Search, FileJson, FolderOpen, RefreshCw, Copy, Download, Check } from 'lucide-react';
import { Button } from '../components/UI/Button';

// Constants
const JSON_FILES = [
    'ArenaLeagueLibrary.json', 'ArenaRewardLibrary.json', 'BaseConfig.json',
    'CountryComplianceLibrary.json', 'DailyDealLibrary.json', 'DungeonBaseConfig.json',
    'DungeonRewardEggLibrary.json', 'DungeonRewardLibrary.json', 'EggDungeonBattleLibrary.json',
    'EggLibrary.json', 'EnemyAgeScalingLibrary.json', 'EnemyLibrary.json',
    'ForgeConfig.json', 'ForgeUpgradeLibrary.json', 'GuildBaseConfig.json',
    'GuildEmblemColors.json', 'GuildTierConfig.json', 'GuildWarConfig.json',
    'GuildWarDayConfigLibrary.json', 'GuildWarProgressPassLibrary.json',
    'HammerThiefDungeonBattleLibrary.json', 'IdleConfig.json', 'InAppProducts.json',
    'ItemAgeDropChancesLibrary.json', 'ItemBalancingConfig.json', 'ItemBalancingLibrary.json',
    'ItemLevelBracketsLibrary.json', 'MainBattleConfig.json', 'MainBattleLibrary.json',
    'MainGameProgressPassLibrary.json', 'MountLibrary.json', 'MountSummonConfig.json',
    'MountSummonDropChancesLibrary.json', 'MountSummonUpgradeLibrary.json',
    'MountUpgradeLibrary.json', 'PetBalancingLibrary.json', 'PetBaseConfig.json',
    'PetLibrary.json', 'PetUpgradeLibrary.json', 'PotionDungeonBattleLibrary.json',
    'ProfileBaseConfig.json', 'ProjectilesLibrary.json', 'PvpBaseConfig.json',
    'SecondaryStatItemUnlockLibrary.json', 'SecondaryStatLibrary.json',
    'SecondaryStatPetUnlockLibrary.json', 'ShopResourcesLibrary.json', 'SkillBaseConfig.json',
    'SkillDungeonBattleLibrary.json', 'SkillLibrary.json', 'SkillPassiveLibrary.json',
    'SkillSummonDropChancesLibrary.json', 'SkillUpgradeLibrary.json', 'StatConfigLibrary.json',
    'TechTreeLibrary.json', 'TechTreePositionLibrary.json', 'TechTreeUpgradeLibrary.json',
    'UnlockConditions.json', 'WeaponLibrary.json', 'WorldIndexConfigLibrary.json'
];

export default function Configs() {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedFile, setSelectedFile] = useState<string | null>(null);

    // Versioning State
    const [versions, setVersions] = useState<string[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<string>('');

    // Cache for all files content { filename: JSONstring }
    const [fileCache, setFileCache] = useState<Record<string, string>>({});
    const [isLoadingAll, setIsLoadingAll] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [copied, setCopied] = useState(false);

    // Initial fetch of versions
    useEffect(() => {
        async function fetchVersions() {
            try {
                const res = await fetch('./parsed_configs/versions.json');
                if (res.ok) {
                    const v = await res.json();
                    // Sort descending (latest first, assuming YYYY_MM_DD format)
                    v.sort((a: string, b: string) => b.localeCompare(a));
                    setVersions(v);
                    if (v.length > 0) {
                        setSelectedVersion(v[0]);
                    }
                }
            } catch (e) {
                console.error("Failed to load versions", e);
            }
        }
        fetchVersions();
    }, []);

    // Initial background fetch (triggered when version is set)
    useEffect(() => {
        if (!selectedVersion) return;

        const fetchAll = async () => {
            setIsLoadingAll(true);
            setFileCache({});
            setSelectedFile(null); // Deselect on version change

            const cache: Record<string, string> = {};
            let loaded = 0;

            try {
                const promises = JSON_FILES.map(async (fileName) => {
                    try {
                        const res = await fetch(`./parsed_configs/${selectedVersion}/${fileName}`);
                        if (res.ok) {
                            const json = await res.json();
                            cache[fileName] = JSON.stringify(json, null, 2);
                        }
                    } catch (e) {
                        console.error(`Failed to load ${fileName}`, e);
                    } finally {
                        loaded++;
                        setLoadingProgress(Math.round((loaded / JSON_FILES.length) * 100));
                    }
                });

                await Promise.all(promises);
                setFileCache(cache);
            } catch (err) {
                console.error("Global fetch error", err);
            } finally {
                setIsLoadingAll(false);
            }
        };

        fetchAll();
    }, [selectedVersion]);

    // Filter files based on Global Search (Name OR Content)
    const filteredFiles = useMemo(() => {
        if (!searchTerm) return JSON_FILES;

        const lowerTerm = searchTerm.toLowerCase();
        return JSON_FILES.filter(fileName => {
            if (fileName.toLowerCase().includes(lowerTerm)) return true;
            const content = fileCache[fileName];
            if (content && content.toLowerCase().includes(lowerTerm)) return true;
            return false;
        });
    }, [searchTerm, fileCache]);

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

    const handleCopy = async () => {
        if (!selectedFile || !fileCache[selectedFile]) return;
        try {
            await navigator.clipboard.writeText(fileCache[selectedFile]);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy!', err);
        }
    };

    const handleDownload = () => {
        if (!selectedFile || !fileCache[selectedFile]) return;

        const blob = new Blob([fileCache[selectedFile]], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = selectedFile;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="h-[calc(100vh-8rem)] flex flex-col md:flex-row gap-6 animate-fade-in">
            {/* Sidebar: File List */}
            <Card className="md:w-80 flex flex-col p-0 overflow-hidden h-full">
                <div className="p-4 border-b border-border bg-bg-secondary/50 space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                            <FolderOpen className="w-5 h-5 text-accent-primary" />
                            Configs
                            <span className="text-xs font-normal text-text-muted bg-bg-input px-2 py-0.5 rounded-full">
                                {filteredFiles.length}
                            </span>
                        </h2>
                    </div>

                    {/* Version Selector */}
                    {versions.length > 0 && (
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
                    {filteredFiles.map(file => (
                        <button
                            key={file}
                            onClick={() => setSelectedFile(file)}
                            className={cn(
                                "w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2",
                                selectedFile === file
                                    ? "bg-gradient-to-r from-accent-primary/20 to-transparent text-accent-primary border border-accent-primary/20"
                                    : "text-text-secondary hover:bg-white/5 hover:text-text-primary"
                            )}
                        >
                            <FileJson className="w-4 h-4 shrink-0 opacity-70" />
                            <div className="flex flex-col overflow-hidden text-left">
                                <span className="truncate">{file.replace('.json', '')}</span>
                                {searchTerm && fileCache[file]?.toLowerCase().includes(searchTerm.toLowerCase()) && (
                                    <span className="text-[10px] text-green-400 font-mono">
                                        Found in content
                                    </span>
                                )}
                            </div>
                        </button>
                    ))}
                    {filteredFiles.length === 0 && (
                        <div className="p-4 text-center text-sm text-text-muted">
                            No files found matching "{searchTerm}"
                        </div>
                    )}
                </div>
            </Card>

            {/* Main Content: JSON Viewer */}
            <Card className="flex-1 overflow-hidden flex flex-col h-full p-0">
                {selectedFile ? (
                    <>
                        <div className="p-4 border-b border-border bg-bg-secondary/50 flex items-center justify-between">
                            <h3 className="font-semibold text-text-primary flex items-center gap-2">
                                <FileJson className="w-5 h-5 text-accent-tertiary" />
                                <span className="truncate">{selectedFile}</span>
                            </h3>
                            <div className="flex items-center gap-2">
                                {fileCache[selectedFile] && (
                                    <span className="text-xs text-text-muted mr-4 hidden sm:inline-block">
                                        {(JSON.parse(fileCache[selectedFile]) as any).length || Object.keys(JSON.parse(fileCache[selectedFile])).length} entries
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

                        <div className="flex-1 overflow-auto p-6 bg-bg-primary/50 relative custom-scrollbar">
                            {!fileCache[selectedFile] ? (
                                <div className="absolute inset-0 flex items-center justify-center bg-bg-card/50 backdrop-blur-sm z-10">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary"></div>
                                </div>
                            ) : (
                                <div className="text-sm font-mono text-text-secondary leading-relaxed whitespace-pre-wrap break-all">
                                    <pre className="font-inherit">
                                        {renderHighlightedContent(fileCache[selectedFile], searchTerm)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-text-muted gap-4">
                        <FolderOpen className="w-16 h-16 opacity-20" />
                        <p>Select a file to view contents</p>
                    </div>
                )}
            </Card>
        </div>
    );
}
