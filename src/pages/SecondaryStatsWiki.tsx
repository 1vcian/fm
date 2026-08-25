import { useState, useEffect, useMemo } from 'react';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { TrendingUp, ArrowRight, RefreshCw, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatVersion } from '../lib/formatVersion';
import { getStatName } from '../utils/statNames';

interface SecondaryStat {
    Stat: string;
    LowerRange: number;
    UpperRange: number;
}

type SecondaryStatLibrary = Record<string, SecondaryStat>;

export default function SecondaryStatsWiki() {
    const [versions, setVersions] = useState<string[]>([]);
    const [baseVersion, setBaseVersion] = useState<string>('');
    const [targetVersion, setTargetVersion] = useState<string>('');
    const [baseData, setBaseData] = useState<SecondaryStatLibrary | null>(null);
    const [targetData, setTargetData] = useState<SecondaryStatLibrary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Initial fetch of versions
    useEffect(() => {
        async function fetchVersions() {
            try {
                const res = await fetch(`${import.meta.env.BASE_URL}parsed_configs/versions.json`);
                if (res.ok) {
                    const v = await res.json();
                    v.sort((a: string, b: string) => b.localeCompare(a));
                    setVersions(v);
                    if (v.length > 0) {
                        setTargetVersion(v[0]);
                        setBaseVersion(v[1] || v[0]);
                    }
                }
            } catch (e) {
                console.error("Failed to load versions", e);
                setError("Failed to load versions manifest.");
            }
        }
        fetchVersions();
    }, []);

    // Fetch data when versions change
    useEffect(() => {
        async function fetchData() {
            if (!baseVersion || !targetVersion) return;
            setLoading(true);
            try {
                const [baseRes, targetRes] = await Promise.all([
                    fetch(`${import.meta.env.BASE_URL}parsed_configs/${baseVersion}/SecondaryStatLibrary.json`),
                    fetch(`${import.meta.env.BASE_URL}parsed_configs/${targetVersion}/SecondaryStatLibrary.json`)
                ]);

                if (baseRes.ok && targetRes.ok) {
                    setBaseData(await baseRes.json());
                    setTargetData(await targetRes.json());
                    setError(null);
                } else {
                    setError("Failed to load data for one or more versions.");
                }
            } catch (e) {
                console.error("Error fetching secondary stats", e);
                setError("Error fetching data from server.");
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [baseVersion, targetVersion]);

    const allStatNames = useMemo(() => {
        const names = new Set<string>();
        if (baseData) Object.keys(baseData).forEach(k => names.add(k));
        if (targetData) Object.keys(targetData).forEach(k => names.add(k));
        return Array.from(names).sort();
    }, [baseData, targetData]);

    const formatValue = (val: number) => {
        // Values are typically decimals (0.01 = 1%)
        return `${(val * 100).toFixed(2)}%`;
    };

    const renderDiff = (base: number, target: number) => {
        const diff = target - base;
        if (Math.abs(diff) < 0.0000000001) return null;
        const isPositive = diff > 0;
        return (
            <span className={cn(
                "text-[10px] font-bold ml-1 px-1 rounded",
                isPositive ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"
            )}>
                {isPositive ? '+' : ''}{(diff * 100).toFixed(2)}%
            </span>
        );
    };

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
                <AlertCircle className="w-12 h-12 text-red-500 opacity-50" />
                <p className="text-text-secondary">{error}</p>
                <Button onClick={() => window.location.reload()}>Retry</Button>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                        Secondary Stats Wiki
                    </h1>
                    <p className="text-text-secondary max-w-2xl font-medium">
                        Base ranges for item and pet secondary statistics.
                    </p>
                </div>

                <Card className="p-2 flex items-center gap-4 bg-bg-secondary/50 border-border/50 shrink-0">
                    <div className="flex flex-col">
                        <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest ml-1">Compare Base</label>
                        <select
                            value={baseVersion}
                            onChange={(e) => setBaseVersion(e.target.value)}
                            className="bg-transparent text-sm font-medium outline-none cursor-pointer hover:text-accent-primary transition-colors"
                        >
                            {versions.map(v => (
                                <option key={v} value={v} className="bg-bg-card">{formatVersion(v)}</option>
                            ))}
                        </select>
                    </div>
                    <ArrowRight className="w-4 h-4 text-text-muted mt-3" />
                    <div className="flex flex-col">
                        <label className="text-[10px] font-bold text-accent-primary uppercase tracking-widest ml-1">Target Version</label>
                        <select
                            value={targetVersion}
                            onChange={(e) => setTargetVersion(e.target.value)}
                            className="bg-transparent text-sm font-medium outline-none cursor-pointer hover:text-accent-primary transition-colors text-accent-primary"
                        >
                            {versions.map(v => (
                                <option key={v} value={v} className="bg-bg-card">
                                    {formatVersion(v)} {v === versions[0] ? '(Latest)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                </Card>
            </div>

            <Card className="overflow-hidden p-0 border-border/50">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-bg-secondary/80 border-b border-border">
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-muted">Stat Name</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-muted">Lower Range (Min)</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-muted">Upper Range (Max)</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-accent-primary">Max Total (12 Slots)</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-text-muted text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-20 text-center">
                                        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-accent-primary opacity-20" />
                                        <p className="text-sm text-text-muted mt-2">Loading data</p>
                                    </td>
                                </tr>
                            ) : (
                                allStatNames.map(name => {
                                    const base = baseData?.[name];
                                    const target = targetData?.[name];

                                    const isNew = !base && target;
                                    const isRemoved = base && !target;
                                    const isModified = base && target && (
                                        Math.abs(base.LowerRange - target.LowerRange) > 0.0000000001 ||
                                        Math.abs(base.UpperRange - target.UpperRange) > 0.0000000001
                                    );

                                    const calculateMaxTotal = (statName: string, upperRange: number) => {
                                        let total = upperRange * 12;
                                        // Cap chance-based stats at 100%
                                        if (statName.toLowerCase().includes('chance')) {
                                            total = Math.min(total, 1.0);
                                        }
                                        return total;
                                    };

                                    return (
                                        <tr
                                            key={name}
                                            className={cn(
                                                "group hover:bg-white/[0.02] transition-colors",
                                                isNew && "bg-green-500/5",
                                                isRemoved && "bg-red-500/5 opacity-50"
                                            )}
                                        >
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={cn(
                                                        "w-1.5 h-10 rounded-full",
                                                        isNew ? "bg-green-500" : isRemoved ? "bg-red-500" : isModified ? "bg-blue-500" : "bg-border"
                                                    )} />
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-text-primary group-hover:text-accent-primary transition-colors">
                                                                {getStatName(name)}
                                                            </span>
                                                        </div>
                                                        <span className="font-mono text-[10px] text-text-muted opacity-50">
                                                            {name}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center">
                                                        <span className="text-sm text-text-secondary font-medium">
                                                            {target ? formatValue(target.LowerRange) : 'N/A'}
                                                        </span>
                                                        {base && target && renderDiff(base.LowerRange, target.LowerRange)}
                                                    </div>
                                                    {isModified && base && (
                                                        <span className="text-[10px] text-text-muted line-through">
                                                            {formatValue(base.LowerRange)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center">
                                                        <span className="text-sm text-text-secondary font-medium">
                                                            {target ? formatValue(target.UpperRange) : 'N/A'}
                                                        </span>
                                                        {base && target && renderDiff(base.UpperRange, target.UpperRange)}
                                                    </div>
                                                    {isModified && base && (
                                                        <span className="text-[10px] text-text-muted line-through">
                                                            {formatValue(base.UpperRange)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-sm font-black text-accent-primary drop-shadow-[0_0_8px_rgba(255,221,0,0.15)]">
                                                    {target ? formatValue(calculateMaxTotal(name, target.UpperRange)) : 'N/A'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {isNew && <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded font-black uppercase tracking-tighter">New</span>}
                                                {isRemoved && <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded font-black uppercase tracking-tighter">Deleted</span>}
                                                {isModified && <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-black uppercase tracking-tighter">Modified</span>}
                                                {!isNew && !isRemoved && !isModified && <span className="text-[10px] text-text-muted font-bold opacity-30">Unchanged</span>}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="p-4 bg-bg-secondary/30 border-border/50">
                    <h3 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-2 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500" /> New Stats
                    </h3>
                    <p className="text-2xl font-bold text-text-primary">
                        {allStatNames.filter(n => !baseData?.[n] && targetData?.[n]).length}
                    </p>
                </Card>
                <Card className="p-4 bg-bg-secondary/30 border-border/50">
                    <h3 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-2 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500" /> Modified Ranges
                    </h3>
                    <p className="text-2xl font-bold text-text-primary">
                        {allStatNames.filter(n => baseData?.[n] && targetData?.[n] && (
                            Math.abs(baseData[n].LowerRange - targetData[n].LowerRange) > 0.0000000001 ||
                            Math.abs(baseData[n].UpperRange - targetData[n].UpperRange) > 0.0000000001
                        )).length}
                    </p>
                </Card>
                <Card className="p-4 bg-bg-secondary/30 border-border/50">
                    <h3 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-2 flex items-center gap-2">
                        <TrendingUp className="w-3 h-3 text-accent-primary" /> Total Stats
                    </h3>
                    <p className="text-2xl font-bold text-text-primary">
                        {allStatNames.length}
                    </p>
                </Card>
            </div>
        </div>
    );
}
