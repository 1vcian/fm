import { useMemo, useState } from 'react';
import { Users, Swords, Heart, Info, Cpu, Coins, Sparkles, Plus, Minus, Lock } from 'lucide-react';
import { Card } from '../components/UI/Card';
import { SpriteIcon } from '../components/UI/SpriteIcon';
import { ResourcesEditor } from '../components/Profile/ResourcesEditor';
import { useProfile } from '../context/ProfileContext';
import { useGameData } from '../hooks/useGameData';
import { useGameDataContext } from '../context/GameDataContext';
import { useGlobalStats } from '../hooks/useGlobalStats';
import { useComparison } from '../context/ComparisonContext';
import { getTechNodeName, getClanIconStyle } from '../utils/techUtils';
import { formatCompactNumber } from '../utils/statsCalculator';
import { cn } from '../lib/utils';

type Tab = 'clan' | 'tree' | 'resources';

export default function Clan() {
    const { profile, getTechLevel, updateProfile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const { excludeSubstats } = useComparison();
    const stats = useGlobalStats(excludeSubstats);
    const [tab, setTab] = useState<Tab>('tree');

    const { data: guildPositionLibrary } = useGameData<any>('GuildTechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');
    const { data: clanIconsMap } = useGameData<any>('ClanTechTreeIconsMap.json');
    const { data: treeMapping } = useGameData<any>('TechTreeMapping.json');

    const hasClan = !!selectedVersion && selectedVersion >= '2026_07_14_16_51';

    // Write a clan node level straight into profile.techTree.Clan so every calculator,
    // counter and the war stats below react to the change (same store the rest of the app reads).
    const setClanLevel = (globalId: number, level: number, max: number) => {
        const v = Math.max(0, Math.min(Math.round(level), max));
        updateProfile({
            techTree: { ...profile.techTree, Clan: { ...profile.techTree.Clan, [globalId]: v } },
        });
    };

    // Flatten clan categories -> sequential globalId (must match TechTree.tsx).
    const categories = useMemo(() => {
        if (!guildPositionLibrary) return [] as { name: string; nodes: { globalId: number; type: string }[] }[];
        let globalId = 0;
        return Object.keys(guildPositionLibrary).map(name => ({
            name,
            nodes: (guildPositionLibrary[name]?.Nodes || []).map((type: string) => ({ globalId: globalId++, type })),
        }));
    }, [guildPositionLibrary]);

    const warMult = (type: string): number => {
        const node = categories.flatMap(c => c.nodes).find((n: { type: string }) => n.type === type);
        const def = node ? guildUpgradeLibrary?.[type] : null;
        // ClanWar* store ValuePerLevel=1.0 as a percent unit (+1%/level) -> /100. Verify in-game.
        return node ? (def?.ValuePerLevel || 0) * getTechLevel('Clan', node.globalId) / 100 : 0;
    };
    const warDamageMult = warMult('ClanWarDamage');
    const warHealthMult = warMult('ClanWarHealth');

    const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
        { id: 'clan', label: 'Clan', icon: <Users className="w-4 h-4" /> },
        { id: 'tree', label: 'My Tree', icon: <Cpu className="w-4 h-4" /> },
        { id: 'resources', label: 'My Resources', icon: <Coins className="w-4 h-4" /> },
    ];

    return (
        <div className="max-w-[100rem] mx-auto space-y-6 animate-fade-in pb-12 px-4 xl:px-8">
            <div className="flex items-center gap-4 border-b border-border pb-5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent-primary/30 to-accent-secondary/20 flex items-center justify-center border border-accent-primary/30">
                    <Users className="w-7 h-7 text-accent-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">Clan</h1>
                    <p className="text-text-muted text-sm">Your clan tech tree, resources, and (soon) shared clan tools</p>
                </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-2 flex-wrap">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={cn(
                            'flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all active:scale-95 border',
                            tab === t.id
                                ? 'bg-accent-primary text-white border-accent-primary shadow-lg shadow-accent-primary/20'
                                : 'bg-bg-input text-text-secondary border-border hover:border-accent-primary/40 hover:text-white'
                        )}
                    >
                        {t.icon}{t.label}
                    </button>
                ))}
            </div>

            {/* ---- COMING SOON ---- */}
            {tab === 'clan' && (
                <Card className="p-10 text-center border-2 border-dashed border-accent-primary/30 bg-gradient-to-b from-accent-primary/5 to-transparent">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-accent-primary/15 flex items-center justify-center mb-4">
                        <Sparkles className="w-8 h-8 text-accent-primary" />
                    </div>
                    <h2 className="text-2xl font-black text-white mb-2">Clan hub — coming soon</h2>
                    <p className="text-text-secondary max-w-xl mx-auto text-sm leading-relaxed">
                        Create or join a clan with a shared password, then see every member&apos;s resources and builds in one place.
                        Profiles will sync to the cloud so your clan can plan Guild War together.
                    </p>
                    <div className="flex items-center justify-center gap-2 mt-5 text-[11px] uppercase tracking-widest text-text-muted">
                        <Lock className="w-3.5 h-3.5" /> Password-protected clan spaces
                    </div>
                </Card>
            )}

            {/* ---- MY TREE ---- */}
            {tab === 'tree' && (
                !hasClan ? (
                    <Card className="p-6 text-text-muted">Clan tech is not available for this data version.</Card>
                ) : !guildPositionLibrary || !guildUpgradeLibrary ? (
                    <Card className="p-6 text-text-muted">Loading clan tech…</Card>
                ) : (
                    <div className="space-y-6">
                        {/* War stats */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Card className="p-4 border-2 border-red-500/30 bg-red-500/5">
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-red-400 mb-2"><Swords className="w-4 h-4" /> Attack during War</div>
                                <div className="text-2xl font-black text-white">{formatCompactNumber((stats?.totalDamage || 0) * (1 + warDamageMult))}</div>
                                <div className="text-[11px] text-text-muted mt-1">Base {formatCompactNumber(stats?.totalDamage || 0)}{warDamageMult > 0 && <span className="text-red-400"> · +{(warDamageMult * 100).toFixed(0)}% war</span>}</div>
                            </Card>
                            <Card className="p-4 border-2 border-green-500/30 bg-green-500/5">
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-green-400 mb-2"><Heart className="w-4 h-4" /> Health during War</div>
                                <div className="text-2xl font-black text-white">{formatCompactNumber((stats?.totalHealth || 0) * (1 + warHealthMult))}</div>
                                <div className="text-[11px] text-text-muted mt-1">Base {formatCompactNumber(stats?.totalHealth || 0)}{warHealthMult > 0 && <span className="text-green-400"> · +{(warHealthMult * 100).toFixed(0)}% war</span>}</div>
                            </Card>
                        </div>
                        <div className="flex items-start gap-2 text-[11px] text-text-muted">
                            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent-primary" />
                            <span>Edit any node below — it writes straight to your profile, so all calculators and counters update instantly. ClanWarDamage / ClanWarHealth apply only during Clan War/Brawl (excluded from your normal stats); per-level scale assumed +1%/level → +100% at max (being verified in-game).</span>
                        </div>

                        {categories.map(cat => (
                            <div key={cat.name} className="space-y-3">
                                <h3 className="text-sm font-bold text-accent-primary capitalize border-b border-white/5 pb-2">{cat.name.replace(/([A-Z])/g, ' $1').trim()}</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                    {cat.nodes.map(({ globalId, type }: { globalId: number; type: string }) => {
                                        const def = guildUpgradeLibrary?.[type];
                                        const maxLevel = def?.MaxLevel ?? 20;
                                        const level = getTechLevel('Clan', globalId);
                                        const valPerLevel = def?.ValuePerLevel ?? 0;
                                        const style = getClanIconStyle(type, clanIconsMap, selectedVersion, import.meta.env.BASE_URL, treeMapping);
                                        const pct = maxLevel > 0 ? (level / maxLevel) * 100 : 0;
                                        return (
                                            <Card key={globalId} className={cn('p-3 flex flex-col gap-2.5 border-2 transition-colors',
                                                level >= maxLevel ? 'border-green-500/50 bg-green-500/10' : level > 0 ? 'border-accent-primary/40 bg-accent-primary/5' : 'border-border/50 bg-bg-primary/50')}>
                                                <div className="flex gap-3 items-center">
                                                    <div className="w-11 h-11 rounded-xl bg-bg-input border border-border overflow-hidden shrink-0 flex items-center justify-center">
                                                        {style ? <div className="w-full h-full" style={style} /> : <Cpu className="w-5 h-5 text-text-muted" />}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <h4 className="text-xs font-bold truncate">{getTechNodeName(type)}</h4>
                                                        <p className="text-[9px] text-text-muted uppercase tracking-wider">Rank {level}/{maxLevel}</p>
                                                        <div className="text-[9px] font-mono flex items-center gap-1 mt-0.5 flex-wrap">
                                                            <SpriteIcon name="GuildPotions" size={11} />
                                                            <span className="text-green-400">{(def?.PointsPerLevel ?? 0).toLocaleString()}</span><span className="opacity-60">/lvl</span>
                                                            {valPerLevel > 0 && <span className="opacity-60">· +{(valPerLevel * 100).toFixed(valPerLevel < 0.1 ? 1 : 0)}%/lvl</span>}
                                                        </div>
                                                    </div>
                                                    {valPerLevel > 0 && level > 0 && (
                                                        <div className="text-right shrink-0">
                                                            <div className="text-[8px] text-text-muted uppercase tracking-wider">Now</div>
                                                            <div className="text-xs font-black text-accent-primary">+{(valPerLevel * level * 100).toFixed(valPerLevel < 0.1 ? 1 : 0)}%</div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* progress */}
                                                <div className="h-1 rounded-full bg-bg-input overflow-hidden">
                                                    <div className={cn('h-full rounded-full transition-all', level >= maxLevel ? 'bg-green-500' : 'bg-accent-primary')} style={{ width: `${pct}%` }} />
                                                </div>

                                                {/* stepper */}
                                                <div className="flex items-center justify-between bg-bg-input rounded-lg border border-border">
                                                    <button
                                                        type="button"
                                                        aria-label="Decrease level"
                                                        className="px-3 py-1.5 text-text-muted hover:text-white active:scale-90 transition disabled:opacity-30 disabled:hover:text-text-muted"
                                                        disabled={level <= 0}
                                                        onClick={() => setClanLevel(globalId, level - 1, maxLevel)}
                                                    >
                                                        <Minus className="w-3.5 h-3.5" />
                                                    </button>
                                                    <input
                                                        type="number"
                                                        className="bg-transparent text-center font-mono font-bold text-sm w-full min-w-0 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                        value={level}
                                                        min={0}
                                                        max={maxLevel}
                                                        onChange={e => { const v = parseInt(e.target.value); setClanLevel(globalId, isNaN(v) ? 0 : v, maxLevel); }}
                                                        onFocus={e => e.target.select()}
                                                    />
                                                    <button
                                                        type="button"
                                                        aria-label="Increase level"
                                                        className="px-3 py-1.5 text-text-muted hover:text-white active:scale-90 transition disabled:opacity-30 disabled:hover:text-text-muted"
                                                        disabled={level >= maxLevel}
                                                        onClick={() => setClanLevel(globalId, level + 1, maxLevel)}
                                                    >
                                                        <Plus className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </Card>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )
            )}

            {/* ---- MY RESOURCES ---- */}
            {tab === 'resources' && <ResourcesEditor />}
        </div>
    );
}
