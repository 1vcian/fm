import { useProfile } from '../../context/ProfileContext';
import { useComparison, FairySelection } from '../../context/ComparisonContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { useGameData } from '../../hooks/useGameData';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { Card } from '../UI/Card';
import { cn } from '../../lib/utils';
import { resolveTextureVersion } from '../../utils/ascensionUtils';
import { FAIRIES, FAIRY_MAX_LEVEL, SEASON_STATS, SeasonFairyStat, fairyPerStep, fairyRawBonus } from '../../utils/fairies';
import { AggregatedStats } from '../../utils/statEngine';
import { Minus, Plus, Sparkles } from 'lucide-react';

/**
 * Compact seasonal-fairy card, sized to sit in the Active Bonuses grid beside the skin sets.
 * Without a variant it edits profile.misc.fairy directly; with variant "original"/"test" it
 * edits that comparison side through ComparisonContext, so two builds can be compared with
 * two different fairies.
 *
 * The grant line shows what the fairy adds: the equipped substat pool feeding the
 * conversion (read from the profile) and, in green, what the verified step + cap math
 * grants for it. Only the fairy level is editable; the pool is what the build carries.
 */

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** The substat pools the grant preview reads off AggregatedStats (all pre-fairy values). */
function defaultPools(cfg: SeasonFairyStat, stats: AggregatedStats) {
    const required =
        cfg.requiredStat === 'skillDamageMulti' ? stats.skillDamageBreakdown?.substats ?? 0
        : cfg.requiredStat === 'skillCooldownMulti' ? stats.skillCooldownBreakdown?.substats ?? 0
        : stats.secondaryHealthMulti ?? 0;
    // Block has no breakdown pool and reflect has no substats at all, so those start at 0.
    const targetBefore = cfg.targetStat === 'criticalChance' ? stats.critChanceBreakdown?.substats ?? 0 : 0;
    return { required, targetBefore };
}

function FairyControls({
    value,
    onChange,
    maxLevel,
}: {
    value: FairySelection;
    onChange: (next: FairySelection) => void;
    maxLevel: number;
}) {
    return (
        <div className="flex items-center gap-1.5 min-w-0">
            <div className="flex gap-1 flex-1 min-w-0">
                {[null, ...FAIRIES.map((f) => f.name)].map((name) => (
                    <button
                        key={name ?? 'none'}
                        onClick={() => onChange({ name, level: value.level })}
                        className={cn(
                            'flex-1 px-1 py-1 rounded border text-[10px] font-semibold transition-colors truncate',
                            value.name === name
                                ? 'bg-accent-primary/20 border-accent-primary/50 text-accent-primary'
                                : 'bg-bg-input border-border text-text-secondary hover:border-accent-primary/30'
                        )}
                    >
                        {name ?? 'None'}
                    </button>
                ))}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
                <button
                    onClick={() => onChange({ name: value.name, level: Math.max(1, value.level - 1) })}
                    disabled={!value.name || value.level <= 1}
                    className="p-1 rounded bg-bg-input border border-border text-text-secondary disabled:opacity-30"
                >
                    <Minus className="w-3 h-3" />
                </button>
                <span className="font-mono font-bold text-xs w-7 text-center">{value.level}</span>
                <button
                    onClick={() => onChange({ name: value.name, level: Math.min(maxLevel, value.level + 1) })}
                    disabled={!value.name || value.level >= maxLevel}
                    className="p-1 rounded bg-bg-input border border-border text-text-secondary disabled:opacity-30"
                >
                    <Plus className="w-3 h-3" />
                </button>
            </div>
        </div>
    );
}

export function FairyCard({ variant }: { variant?: 'original' | 'test' }) {
    const { profile, updateNestedProfile } = useProfile();
    const { originalFairy, testFairy, updateOriginalFairy, updateTestFairy } = useComparison();
    const { selectedVersion } = useGameDataContext();
    const { data: fairyUpgrades } = useGameData<Record<string, { Level: number }>>('FairyUpgradesLibrary.json');
    const stats = useGlobalStats(false);

    const maxLevel = fairyUpgrades ? Math.max(...Object.keys(fairyUpgrades).map(Number)) : FAIRY_MAX_LEVEL;
    const stored: FairySelection = profile.misc.fairy ?? { name: null, level: 1 };
    const value: FairySelection =
        variant === 'original' ? originalFairy ?? stored
        : variant === 'test' ? testFairy ?? stored
        : stored;
    const onChange =
        variant === 'original' ? updateOriginalFairy
        : variant === 'test' ? updateTestFairy
        : (next: FairySelection) => updateNestedProfile('misc', { fairy: next });
    const cfg = value.name ? SEASON_STATS[value.name] : null;

    // Grant preview: exact engine numbers when the shown fairy is the profile's own, the
    // pre-fairy pools otherwise (a compare side can pick a different fairy).
    const exact = stats?.fairyBonus && value.name === stored.name ? stats.fairyBonus : null;
    const pools = cfg && stats ? defaultPools(cfg, stats) : null;
    const required = exact ? exact.required : pools?.required ?? 0;
    const targetBefore = exact ? exact.targetPoolBefore : pools?.targetBefore ?? 0;

    const raw = cfg ? fairyRawBonus(cfg, value.level, required) : 0;
    const granted = cfg && raw > 0
        ? Math.max(0, Math.min(targetBefore + raw, cfg.targetStatTotalCap) - targetBefore)
        : 0;

    const texVersion = resolveTextureVersion(selectedVersion) ?? selectedVersion;
    const texture = FAIRIES.find((f) => f.name === value.name)?.texture;

    return (
        <Card className="p-3 bg-bg-secondary/40 border-border/50">
            <div className="flex items-start justify-between mb-2">
                <div className="min-w-0">
                    <div className="text-xs font-black uppercase tracking-wider mb-0.5 text-text-primary">
                        Fairy
                    </div>
                    <div className="text-[10px] text-text-muted leading-snug">
                        {cfg
                            ? `+${pct(fairyPerStep(cfg, value.level))} ${cfg.targetLabel} per ${cfg.requiredStatIsReduction ? '-' : '+'}${pct(cfg.requiredStatValueDivider)} ${cfg.requiredLabel} equipped, cap +${pct(cfg.targetStatTotalCap)}`
                            : 'Seasonal event bonus'}
                    </div>
                </div>
                <div className="w-9 h-9 rounded-lg bg-bg-input flex items-center justify-center p-1 shrink-0 ml-2">
                    {texture ? (
                        <img src={`${import.meta.env.BASE_URL}Texture2D/${texVersion}/${texture}`} alt={value.name ?? 'Fairy'} className="w-full h-full object-contain" />
                    ) : (
                        <Sparkles className="w-4 h-4 text-accent-primary" />
                    )}
                </div>
            </div>

            <FairyControls value={value} onChange={onChange} maxLevel={maxLevel} />

            {cfg && stats && (
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-text-muted truncate">
                        {pct(Math.abs(required))} {cfg.requiredLabel} equipped
                    </span>
                    <span className="font-mono font-bold text-green-400 shrink-0">
                        +{pct(granted)} {cfg.targetLabel}
                    </span>
                </div>
            )}
        </Card>
    );
}
