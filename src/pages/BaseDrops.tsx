import { useState, useEffect } from 'react';
import { Card } from '../components/UI/Card';
import { cn, getAgeIconStyle, getRarityBorderStyle } from '../lib/utils';
import { HelpCircle, RefreshCw, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import { SpriteIcon } from '../components/UI/SpriteIcon';
import { Button } from '../components/UI/Button';
import { AGES, RARITIES } from '../utils/constants';

type TabType = 'forge' | 'eggs' | 'mounts' | 'skills';

export default function BaseDrops() {
    const [activeTab, setActiveTab] = useState<TabType>('forge');
    const [isCompareMode, setIsCompareMode] = useState(false);
    const [baseVersion, setBaseVersion] = useState('');
    const [targetVersion, setTargetVersion] = useState('');
    const [versions, setVersions] = useState<string[]>([]);
    
    // Cache for relevant files: { [version]: { [fileName]: data } }
    const [dataCache, setDataCache] = useState<Record<string, Record<string, any>>>({});
    const [isLoading, setIsLoading] = useState(false);

    const RELEVANT_FILES = {
        forge: 'ItemAgeDropChancesLibrary.json',
        eggs: 'EggSummonConfig.json',
        mounts: 'MountSummonDropChancesLibrary.json',
        mountConfig: 'MountSummonConfig.json',
        skills: 'SkillSummonDropChancesLibrary.json',
        skillConfig: 'SkillSummonConfig.json'
    };

    // Initial fetch of versions
    useEffect(() => {
        async function fetchVersions() {
            try {
                const res = await fetch('./parsed_configs/versions.json');
                if (res.ok) {
                    const v = await res.json();
                    v.sort((a: string, b: string) => b.localeCompare(a));
                    setVersions(v);
                    if (v.length > 0) {
                        setTargetVersion(v[0]);
                        if (v.length > 1) setBaseVersion(v[1]);
                        else setBaseVersion(v[0]);
                    }
                }
            } catch (e) {
                console.error("Failed to load versions", e);
            }
        }
        fetchVersions();
    }, []);

    // Fetch data for both versions when they change
    useEffect(() => {
        const versionsToFetch = isCompareMode ? [baseVersion, targetVersion] : [targetVersion];
        const fetchNeeded = versionsToFetch.filter(v => v && (!dataCache[v] || Object.keys(dataCache[v]).length < Object.keys(RELEVANT_FILES).length));

        if (fetchNeeded.length === 0) return;

        const fetchData = async () => {
            setIsLoading(true);
            const newData = { ...dataCache };

            for (const v of fetchNeeded) {
                const results: Record<string, any> = newData[v] || {};
                await Promise.all(Object.entries(RELEVANT_FILES).map(async ([_, fileName]) => {
                    if (results[fileName]) return;
                    try {
                        const res = await fetch(`./parsed_configs/${v}/${fileName}`);
                        if (res.ok) {
                            results[fileName] = await res.json();
                        }
                    } catch (e) {
                        console.warn(`Failed to load ${fileName} for ${v}`);
                    }
                }));
                newData[v] = results;
            }

            setDataCache(newData);
            setIsLoading(false);
        };

        fetchData();
    }, [baseVersion, targetVersion, isCompareMode, dataCache]);

    const formatPercent = (val: number) => {
        if (val === undefined || val === null) return '-';
        return (val * 100).toFixed(3) + '%';
    };

    const renderComparisonValue = (baseVal: number, targetVal: number) => {
        const diff = targetVal - baseVal;
        const isBetter = diff > 0;
        const hasDiff = Math.abs(diff) > 0.0000001;
        
        return (
            <div className={cn(
                "flex flex-col items-end p-1 rounded transition-colors group/cell",
                hasDiff && (isBetter ? "bg-green-500/10" : "bg-red-500/10")
            )}>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-muted opacity-50">{formatPercent(baseVal)}</span>
                    <ArrowRight className="w-2.5 h-2.5 text-text-muted opacity-30" />
                    <span className={cn("font-bold", hasDiff ? (isBetter ? "text-green-400" : "text-red-400") : "text-text-primary")}>
                        {formatPercent(targetVal)}
                    </span>
                </div>
                {hasDiff && (
                    <div className={cn("flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-tighter", isBetter ? "text-green-500" : "text-red-500")}>
                        {isBetter ? <TrendingUp className="w-2 h-2" /> : <TrendingDown className="w-2 h-2" />}
                        {isBetter ? "+" : ""}{formatPercent(diff)}
                    </div>
                )}
            </div>
        );
    };

    const renderTable = () => {
        const baseData = dataCache[baseVersion]?.[RELEVANT_FILES[activeTab]];
        const targetData = dataCache[targetVersion]?.[RELEVANT_FILES[activeTab]];

        if (!targetData && !isLoading) return <div className="p-10 text-center text-text-muted">No data available for this version.</div>;
        if (isLoading && !targetData) return (
            <div className="p-20 flex flex-col items-center justify-center gap-4">
                <RefreshCw className="w-8 h-8 animate-spin text-accent-primary" />
                <span className="text-text-muted">Fetching drop table data...</span>
            </div>
        );

        if (activeTab === 'forge') {
            const levels = Object.keys(targetData || {}).sort((a, b) => Number(a) - Number(b));
            return (
                <div className="overflow-auto custom-scrollbar max-h-[70vh] bg-bg-primary">
                    <table className="w-full text-sm text-left border-collapse table-fixed">
                        <thead>
                            <tr className="border-b border-border bg-bg-secondary/80">
                                <th className="p-4 sticky left-0 top-0 bg-bg-secondary z-30 w-[80px] border-r border-b border-border/50">
                                    <div className="flex flex-col items-center">
                                        <span className="text-[10px] uppercase text-text-muted">Forge</span>
                                        <span className="text-xs font-bold font-mono">Level</span>
                                    </div>
                                </th>
                                {AGES.map((age, idx) => (
                                    <th key={age} className="p-4 font-bold text-center group w-[120px] sticky top-0 bg-bg-secondary z-20 border-b border-border/50">
                                        <div className="flex flex-col items-center gap-1">
                                            <div style={getAgeIconStyle(idx, 24)} className="group-hover:scale-110 transition-transform" />
                                            <span className="text-[10px] uppercase tracking-wider text-text-muted group-hover:text-text-primary transition-colors">{age}</span>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {levels.map(lvl => {
                                const targetRow = targetData[lvl];
                                const baseRow = isCompareMode ? baseData?.[lvl] : null;
                                
                                return (
                                    <tr key={lvl} className="border-b border-border/10 hover:bg-white/5 transition-colors group">
                                        <td className="p-4 font-mono font-bold sticky left-0 bg-bg-primary shadow-r border-r border-border/50 text-center text-accent-primary z-10">
                                            {Number(lvl) + 1}
                                        </td>
                                        {AGES.map((_, idx) => {
                                            const key = `Age${idx}`;
                                            const tVal = targetRow?.[key] ?? 0;
                                            const bVal = isCompareMode ? (baseRow?.[key] ?? 0) : tVal;

                                            return (
                                                <td key={key} className={cn("p-4 text-right font-mono", (tVal > 0 || bVal > 0) ? "text-text-primary" : "text-text-muted opacity-10")}>
                                                    {isCompareMode ? renderComparisonValue(bVal, tVal) : (tVal > 0 ? formatPercent(tVal) : '-')}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            );
        }

        // Skills, Mounts, Eggs follow similar structure
        if (activeTab === 'mounts' || activeTab === 'skills' || activeTab === 'eggs') {
            const isEgg = activeTab === 'eggs';
            const summonConfigKey = activeTab === 'mounts' ? 'mountConfig' : 'skillConfig';
            const summonConfigTarget = dataCache[targetVersion]?.[RELEVANT_FILES[summonConfigKey]];
            const summonConfigBase = isCompareMode ? dataCache[baseVersion]?.[RELEVANT_FILES[summonConfigKey]] : null;

            let levels: any[] = [];
            if (isEgg) {
                levels = targetData?.Levels || [];
            } else {
                levels = Object.keys(targetData || {}).sort((a, b) => Number(a) - Number(b)).map(k => ({ ...targetData[k], key: k }));
            }

            return (
                <div className="overflow-auto custom-scrollbar max-h-[70vh] bg-bg-primary">
                    <table className="w-full text-sm text-left border-collapse table-fixed">
                        <thead>
                            <tr className="border-b border-border bg-bg-secondary/80">
                                <th className="p-4 sticky left-0 top-0 bg-bg-secondary z-30 w-[100px] border-r border-b border-border/50">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] uppercase text-text-muted">Summon</span>
                                        <span className="text-xs font-bold font-mono">Level</span>
                                    </div>
                                </th>
                                <th className="p-4 bg-bg-secondary/95 w-[140px] text-center border-r border-b border-border/50 sticky top-0 z-20">
                                    <div className="flex flex-col items-center">
                                        <RefreshCw className="w-4 h-4 text-text-muted mb-1" />
                                        <span className="text-[10px] uppercase text-text-muted">Next Level</span>
                                    </div>
                                </th>
                                {RARITIES.map(rarity => (
                                    <th key={rarity} className="p-4 font-bold text-center w-[120px] sticky top-0 bg-bg-secondary z-20 border-b border-border/50">
                                        <div className="flex flex-col items-center gap-1">
                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getRarityBorderStyle(rarity).borderColor as string }} />
                                            <span className="text-[10px] uppercase tracking-widest" style={{ color: getRarityBorderStyle(rarity).borderColor as string }}>
                                                {rarity}
                                            </span>
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {levels.map((targetRow, i) => {
                                const lvlIdx = isEgg ? i : Number(targetRow.key);
                                const baseRow = isCompareMode ? (isEgg ? baseData?.Levels?.[i] : baseData?.[targetRow.key]) : null;
                                
                                // Get summons required for next level
                                let tSummons = 0;
                                let bSummons = 0;
                                if (isEgg) {
                                    tSummons = targetRow.SummonsRequired;
                                    bSummons = baseRow?.SummonsRequired ?? tSummons;
                                } else if (summonConfigTarget?.Levels?.[lvlIdx]) {
                                    tSummons = summonConfigTarget.Levels[lvlIdx].SummonsRequired;
                                    bSummons = isCompareMode ? (summonConfigBase?.Levels?.[lvlIdx]?.SummonsRequired ?? tSummons) : tSummons;
                                }

                                return (
                                    <tr key={i} className="border-b border-border/10 hover:bg-white/5 transition-colors group">
                                        <td className="p-4 font-mono font-bold sticky left-0 bg-bg-primary shadow-r border-r border-border/50 text-center text-accent-primary z-10">
                                            {lvlIdx + 1}
                                        </td>
                                        <td className="p-4 text-center border-r border-border/30 font-mono font-bold bg-bg-secondary/5">
                                            {isCompareMode && tSummons !== bSummons ? (
                                                <div className="flex flex-col items-center">
                                                    <div className="flex items-center gap-1.5 text-[10px] opacity-40">
                                                        <span>{bSummons}</span>
                                                        <ArrowRight className="w-2.5 h-2.5" />
                                                        <span className="font-bold">{tSummons}</span>
                                                    </div>
                                                    <div className={cn("text-[9px]", tSummons < bSummons ? "text-green-400" : "text-red-400")}>
                                                        {tSummons < bSummons ? '↓ Faster' : '↑ Slower'} ({(tSummons - bSummons)})
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-text-secondary">{tSummons || '-'}</span>
                                            )}
                                        </td>
                                        {RARITIES.map(rarity => {
                                            const tVal = targetRow?.[rarity] ?? 0;
                                            const bVal = isCompareMode ? (baseRow?.[rarity] ?? 0) : tVal;
                                            const rarityColor = getRarityBorderStyle(rarity).borderColor as string;

                                            return (
                                                <td 
                                                    key={rarity} 
                                                    className={cn("p-4 text-right font-mono border-r border-border/5 group-hover:bg-white/10 transition-colors")}
                                                    style={{ backgroundColor: (tVal > 0 || bVal > 0) ? `rgba(${rarityColor.replace('rgb(', '').replace(')', '')}, 0.04)` : 'transparent' }}
                                                >
                                                    <div className={cn((tVal > 0 || bVal > 0) ? "text-text-primary" : "text-text-muted opacity-10")}>
                                                        {isCompareMode ? renderComparisonValue(bVal, tVal) : (tVal > 0 ? formatPercent(tVal) : '-')}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            );
        }

        return null;
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500 pb-20">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
                <div>
                    <h1 className="text-4xl font-black bg-gradient-to-r from-accent-primary via-accent-secondary to-accent-primary bg-animate-gradient bg-clip-text text-transparent mb-2 flex items-center gap-4">
                        <HelpCircle className="w-12 h-12 text-accent-primary" />
                        BASE DROPS WIKI
                    </h1>
                    <p className="text-text-secondary max-w-2xl font-medium">
                        Reference tables for all dynamic drop percentages. Monitor changes across configuration versions and plan your progression.
                    </p>
                </div>

                <Card className="p-4 flex flex-wrap gap-4 items-center bg-bg-secondary/40 backdrop-blur-xl border-accent-primary/20 shadow-xl">
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                            <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1 ml-1">Current Version</label>
                            <select
                                value={targetVersion}
                                onChange={(e) => setTargetVersion(e.target.value)}
                                className="bg-bg-input border border-border/50 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-accent-primary transition-colors appearance-none cursor-pointer pr-8 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCAyNCAyNCIgc3Ryb2tlPSJ3aGl0ZSI+PHBhdGggc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2Utd2lkdGg9IjIiIGQ9Ik0xOSA5bC03IDctNy03Ii8+PC9zdmc+')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
                            >
                                {versions.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                        </div>
                        
                        {isCompareMode && (
                            <>
                                <div className="p-2 rounded-full bg-accent-primary/10 mt-4">
                                    <ArrowRight className="w-4 h-4 text-accent-primary" />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1 ml-1 text-right">Comparing Against</label>
                                    <select
                                        value={baseVersion}
                                        onChange={(e) => setBaseVersion(e.target.value)}
                                        className="bg-bg-input border border-border/50 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:border-accent-primary transition-colors appearance-none cursor-pointer pr-8 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCAyNCAyNCIgc3Ryb2tlPSJ3aGl0ZSI+PHBhdGggc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBzdHJva2Utd2lkdGg9IjIiIGQ9Ik0xOSA5bC03IDctNy03Ii8+PC9zdmc+')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
                                    >
                                        {versions.map(v => <option key={v} value={v}>{v}</option>)}
                                    </select>
                                </div>
                            </>
                        )}
                    </div>
                    
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setIsCompareMode(!isCompareMode)}
                        className={cn(
                            "h-10 px-6 uppercase tracking-widest text-[10px] font-black mt-4 border-2 shadow-lg transition-all",
                            isCompareMode 
                                ? "bg-accent-secondary border-accent-secondary text-black" 
                                : "bg-accent-primary/20 border-accent-primary/50 text-white hover:bg-accent-primary hover:text-black shadow-lg shadow-accent-primary/10"
                        )}
                    >
                        {isCompareMode ? "Exit Compare" : "Compare Versions"}
                    </Button>
                </Card>
            </div>

            <div className="flex p-1 bg-bg-secondary/30 rounded-2xl border border-white/5 w-fit">
                {[
                    { id: 'forge', label: 'Forge', icon: 'Hammer' },
                    { id: 'eggs', label: 'Eggs', icon: 'Egg' },
                    { id: 'mounts', label: 'Mounts', icon: 'MountKey' },
                    { id: 'skills', label: 'Skills', icon: 'SkillKey' },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        className={cn(
                            "px-8 py-3 flex items-center gap-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all",
                            activeTab === tab.id 
                                ? "bg-accent-primary text-black shadow-lg shadow-accent-primary/20 scale-105 z-10" 
                                : "text-text-muted hover:text-text-primary hover:bg-white/5"
                        )}
                    >
                         <SpriteIcon 
                            name={tab.icon} 
                            size={16} 
                            className={cn(
                                "transition-all",
                                activeTab === tab.id ? "" : "opacity-70 group-hover:opacity-100"
                            )} 
                        />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <Card className="p-0 overflow-hidden border-border/40 shadow-2xl relative bg-bg-primary/40 backdrop-blur-sm border-2">
                {renderTable()}
            </Card>

            {isCompareMode && (
                <div className="flex items-center justify-center gap-8 py-4 bg-bg-secondary/20 rounded-2xl border border-white/5 font-mono text-[10px] font-bold tracking-tighter uppercase opacity-60">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-green-500/20 border border-green-500/50" />
                        <span>Increased Chance</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-red-500/20 border border-red-500/50" />
                        <span>Decreased Chance</span>
                    </div>
                    <div className="flex items-center gap-2 text-text-muted">
                        <ArrowRight className="w-3 h-3" />
                        <span>Old Value → New Value</span>
                    </div>
                </div>
            )}
        </div>
    );
}
