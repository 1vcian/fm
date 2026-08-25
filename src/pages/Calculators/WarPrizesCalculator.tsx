import { useState, useMemo } from 'react';
import { useGameData } from '../../hooks/useGameData';
import { useGameDataContext } from '../../context/GameDataContext';
import { useProfile } from '../../context/ProfileContext';
import { useTreeModifiers, useClanNodeMax } from '../../hooks/useCalculatedStats';
import { SandboxPanel } from '../../components/UI/SandboxPanel';
import { SpriteIcon } from '../../components/UI/SpriteIcon';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/UI/Card';
import { Trophy, Swords } from 'lucide-react';
import { cn } from '../../lib/utils';

interface CurrencyReward { Amount: number; Type: string; $type: string; }
interface TierConfig {
    Tier: string;
    RequiredPoints: number;
    WarWonRewards: CurrencyReward[];
    WarLostRewards: CurrencyReward[];
    TierPointsOnWin?: number;
    TierPointsOnLose?: number;
}

// Best-effort currency -> sprite icon; unknown ones fall back to a text chip.
const CURRENCY_ICON: Record<string, string> = {
    Hammers: 'Hammer',
    SkillSummonTickets: 'SkillTicket',
    Eggshells: 'Eggshell',
    TechPotions: 'Potion',
    ClockWinders: 'MountKey',
    GuildPotions: 'GuildPotions',
    Gems: 'GemSquare',
    Coins: 'Coin',
};

export default function WarPrizesCalculator() {
    const { data: tierConfig } = useGameData<Record<string, TierConfig>>('GuildTierConfig.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');
    const { selectedVersion } = useGameDataContext();
    const { profile } = useProfile();
    const defaultAscension =
        (profile?.misc?.mountAscensionLevel || 0) +
        (profile?.misc?.skillAscensionLevel || 0) +
        (profile?.misc?.forgeAscensionLevel || 0) +
        (profile?.misc?.petAscensionLevel || 0);

    const winStep = guildUpgradeLibrary?.['ClanWarWinRewards']?.ValuePerLevel || 0.005;
    const loseStep = guildUpgradeLibrary?.['ClanWarLoseRewards']?.ValuePerLevel || 0.005;
    const potWinStep = guildUpgradeLibrary?.['GuildPotionsFromClanWarWin']?.ValuePerLevel || 0.01;
    const potLoseStep = guildUpgradeLibrary?.['GuildPotionsFromClanWarLose']?.ValuePerLevel || 0.01;

    // Clan tech tree reward multipliers (already effective, see useGameData).
    const treeModifiers = useTreeModifiers();
    const clanMax = useClanNodeMax();
    const profileWin = treeModifiers['ClanWarWinRewards'] || 0;
    const profileLose = treeModifiers['ClanWarLoseRewards'] || 0;
    const profilePotionsWin = treeModifiers['GuildPotionsFromClanWarWin'] || 0;
    const profilePotionsLose = treeModifiers['GuildPotionsFromClanWarLose'] || 0;

    // Sandbox overrides
    const [sandbox, setSandbox] = useState<Record<string, number>>({});
    const winBonus = sandbox.win ?? profileWin;
    const loseBonus = sandbox.lose ?? profileLose;
    const potionsWinBonus = sandbox.potWin ?? profilePotionsWin;
    const potionsLoseBonus = sandbox.potLose ?? profilePotionsLose;
    const ascensionStars = sandbox.ascensionStars ?? defaultAscension;

    const isSandboxModified = useMemo(() => {
        return (
            Math.abs(winBonus - profileWin) > 1e-9 ||
            Math.abs(loseBonus - profileLose) > 1e-9 ||
            Math.abs(potionsWinBonus - profilePotionsWin) > 1e-9 ||
            Math.abs(potionsLoseBonus - profilePotionsLose) > 1e-9 ||
            ascensionStars !== defaultAscension
        );
    }, [winBonus, profileWin, loseBonus, profileLose, potionsWinBonus, profilePotionsWin, potionsLoseBonus, profilePotionsLose, ascensionStars, defaultAscension]);

    const sandboxControls = {
        reset: () => setSandbox({}),
        fields: [
            { key: 'win', label: 'Win war rewards', value: winBonus, profileValue: profileWin, min: 0, max: clanMax['ClanWarWinRewards'] || 0.1, step: winStep, onChange: (v: number) => setSandbox(p => ({ ...p, win: v })) },
            { key: 'lose', label: 'Lost war rewards', value: loseBonus, profileValue: profileLose, min: 0, max: clanMax['ClanWarLoseRewards'] || 0.1, step: loseStep, onChange: (v: number) => setSandbox(p => ({ ...p, lose: v })) },
            { key: 'potWin', label: 'Guild potions (win)', value: potionsWinBonus, profileValue: profilePotionsWin, min: 0, max: clanMax['GuildPotionsFromClanWarWin'] || 1, step: potWinStep, onChange: (v: number) => setSandbox(p => ({ ...p, potWin: v })) },
            { key: 'potLose', label: 'Guild potions (lose)', value: potionsLoseBonus, profileValue: profilePotionsLose, min: 0, max: clanMax['GuildPotionsFromClanWarLose'] || 1, step: potLoseStep, onChange: (v: number) => setSandbox(p => ({ ...p, potLose: v })) },
        ],
    };

    const tiers = useMemo(() => (tierConfig ? Object.values(tierConfig).sort((a, b) => a.RequiredPoints - b.RequiredPoints) : []), [tierConfig]);
    const [tierIdx, setTierIdx] = useState(0);
    const tier = tiers[tierIdx];

    // Apply the multipliers; GuildPotions get an extra win/lose-specific boost and ascension stars boost (+10% per star).
    // The calculation is multiplicative between the war/potions tree multipliers and the ascension stars.
    const applyBonus = (rewards: CurrencyReward[], baseBonus: number, potionBonus: number) =>
        (rewards || []).map(r => {
            if (r.Type === 'GuildPotions') {
                const boosted = r.Amount * (1 + baseBonus + potionBonus) * (1 + ascensionStars * 0.1);
                return { ...r, boosted };
            }
            return { ...r, boosted: r.Amount * (1 + baseBonus) };
        });

    const wonRewards = tier ? applyBonus(tier.WarWonRewards, winBonus, potionsWinBonus) : [];
    const lostRewards = tier ? applyBonus(tier.WarLostRewards, loseBonus, potionsLoseBonus) : [];

    const RewardRow = ({ type, base, boosted }: { type: string; base: number; boosted: number }) => {
        const icon = CURRENCY_ICON[type];
        const changed = Math.abs(boosted - base) > 0.5;
        const isGuildPotions = type === 'GuildPotions';
        return (
            <div className="flex items-center justify-between gap-3 py-1.5 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                    {icon ? <SpriteIcon name={icon} size={22} /> : <span className="w-[22px]" />}
                    <span className="text-xs text-text-secondary whitespace-nowrap overflow-hidden text-clip">{type.replace(/([A-Z])/g, ' $1').trim()}</span>
                    {isGuildPotions && ascensionStars > 0 && (
                        <div className="flex items-center gap-0.5 shrink-0 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                            <img
                                src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion}/AscensionStar.png`}
                                alt="Ascension"
                                className="w-3 h-3 object-contain"
                            />
                            <span className="text-[10px] text-amber-400 font-mono font-bold">x{ascensionStars}</span>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2 font-mono">
                    {changed && <span className="text-[10px] text-text-muted line-through">{Math.round(base).toLocaleString()}</span>}
                    <span className={cn('font-bold', changed ? 'text-purple-300' : 'text-white')}>{Math.round(boosted).toLocaleString()}</span>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6 animate-fade-in pb-20 max-w-5xl mx-auto">
            <div className="text-center space-y-2 mb-2">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent inline-flex items-center gap-3">
                    <Trophy size={32} className="text-accent-primary" />
                    War Prizes Calculator
                </h1>
                <p className="text-text-secondary">Guild War win/lose rewards per tier, boosted by your clan tech tree.</p>
            </div>

            <SandboxPanel
                fields={sandboxControls.fields}
                onReset={sandboxControls.reset}
                isModified={isSandboxModified}
            >
                <div className="pt-4 border-t border-purple-500/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">Ascension Stars</span>
                        <div className="relative">
                            <select
                                value={ascensionStars}
                                onChange={(e) => setSandbox(p => ({ ...p, ascensionStars: parseInt(e.target.value) }))}
                                className="bg-bg-input border border-purple-500/30 hover:border-purple-500/50 focus:border-purple-500/80 rounded-lg px-3 py-1.5 text-xs text-white outline-none transition-all font-mono cursor-pointer appearance-none pr-8"
                            >
                                {Array.from({ length: 13 }).map((_, idx) => (
                                    <option key={idx} value={idx}>
                                        {idx} {idx === 1 ? 'Star' : 'Stars'} (+{idx * 10}%)
                                    </option>
                                ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-purple-400">
                                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                                </svg>
                            </div>
                        </div>
                    </div>
                    {/* Visual stars preview */}
                    <div className="flex items-center gap-1 min-h-[24px] flex-wrap bg-purple-500/10 rounded-lg px-3 py-1.5 border border-purple-500/20">
                        {ascensionStars > 0 ? (
                            <div className="flex items-center gap-0.5">
                                {Array.from({ length: ascensionStars }).map((_, idx) => (
                                    <img
                                        key={idx}
                                        src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion}/AscensionStar.png`}
                                        alt="Star"
                                        className="w-4 h-4 object-contain drop-shadow-[0_0_3px_rgba(251,191,36,0.6)] animate-fade-in"
                                        style={{ animationDelay: `${idx * 20}ms` }}
                                    />
                                ))}
                            </div>
                        ) : (
                            <span className="text-[10px] text-purple-300/60 italic font-medium">No ascension stars active</span>
                        )}
                    </div>
                </div>
            </SandboxPanel>

            {/* Guild tier selector */}
            <Card className="p-4">
                <div className="flex items-center gap-2 flex-wrap justify-center">
                    <span className="text-xs text-text-muted uppercase font-bold mr-2">Guild Tier</span>
                    {tiers.map((t, i) => (
                        <button
                            key={t.Tier}
                            onClick={() => setTierIdx(i)}
                            className={cn(
                                'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                                i === tierIdx ? 'bg-accent-primary text-black border-accent-primary' : 'text-text-muted border-white/10 hover:border-white/30'
                            )}
                        >
                            {t.Tier}
                        </button>
                    ))}
                </div>
            </Card>

            {tier && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card className="p-6 border-emerald-500/20">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-emerald-300">
                                <Trophy size={18} /> War Won
                                {winBonus > 0 && <span className="text-[11px] font-mono text-purple-300">+{(winBonus * 100).toFixed(1)}%</span>}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {wonRewards.map(r => <RewardRow key={r.Type} type={r.Type} base={r.Amount} boosted={r.boosted} />)}
                            {tier.TierPointsOnWin != null && <div className="text-[11px] text-text-muted mt-3">+{tier.TierPointsOnWin} guild tier points</div>}
                        </CardContent>
                    </Card>

                    <Card className="p-6 border-red-500/20">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-red-300">
                                <Swords size={18} /> War Lost
                                {loseBonus > 0 && <span className="text-[11px] font-mono text-purple-300">+{(loseBonus * 100).toFixed(1)}%</span>}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {lostRewards.map(r => <RewardRow key={r.Type} type={r.Type} base={r.Amount} boosted={r.boosted} />)}
                            {tier.TierPointsOnLose != null && <div className="text-[11px] text-text-muted mt-3">+{tier.TierPointsOnLose} guild tier points</div>}
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
