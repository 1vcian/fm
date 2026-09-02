import { useMemo } from 'react';
import { Card, CardContent } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { useGameData } from '../hooks/useGameData';
import { useGameDataContext } from '../context/GameDataContext';
import { usePersistentState } from '../hooks/usePersistentState';
import { Sparkles } from 'lucide-react';

/**
 * Fairies wiki page. A level slider drives the per level and total upgrade cost under each
 * fairy, the way the Items wiki drives item stats.
 *
 * FairyUpgradesLibrary is the ONLY [GameConfigEntry] for fairies: levels 2 to 20, each with a
 * Price[] of five currencies. The client looks a price up by currency
 * (FairyUpgradeLibrary.GetCostWithCurrencyOrDefault), so the five are alternatives, one
 * payment per level, not a combined bill.
 *
 * Fairy names come from the texture filenames because Localization.json ships no fairy strings.
 */

interface Price {
    Amount: number;
    Currency: string;
}

interface FairyUpgrade {
    Level: number;
    Costs: Price[];
}

const FAIRIES = [
    { name: 'Lora', texture: 'FairyIconLora.png' },
    { name: 'Mira', texture: 'FairyIconMira.png' },
    { name: 'Tira', texture: 'FairyIconTira.png' },
] as const;

/**
 * Currency art. IconsMap uses the game's own summon-key names, which do not match the config's
 * currency ids, so each one is pinned by what actually spends it: MountSummonConfig spends
 * ClockWinders (hence MountKey), SkillSummonConfig spends SkillSummonTickets, EggSummonConfig
 * spends Eggshells.
 */
const CURRENCY: Record<string, { label: string; icon: string }> = {
    Coins: { label: 'Coins', icon: 'Coin' },
    SkillSummonTickets: { label: 'Skill Tickets', icon: 'SkillTicket' },
    Eggshells: { label: 'Eggshells', icon: 'Eggshell' },
    TechPotions: { label: 'Tech Potions', icon: 'Potion' },
    ClockWinders: { label: 'Clock Winders', icon: 'MountKey' },
};

const nf = new Intl.NumberFormat('en-US');

/* ---------------------------------------------------------------------------------------------
 * Kept deliberately, not rendered.
 *
 * A fairy's actual conversion lives in FairyStatLibrary, which is MetaMember-serialized but is
 * NOT a config entry: it reaches the client with the seasonal event, so the values are absent
 * from the archive we parse. The shape below is already known from the class definition, so
 * when a season's numbers do become readable this page only needs the data wired in, not
 * another round of reverse engineering.
 *
 *   granted = (RequiredStatType / RequiredStatValueDivider)
 *             x (TargetStatBonus + TargetStatBonusPerLevel x level)
 *   clamped to TargetStatTotalCap when HasCap is set
 *
 *   RequiredStatType          the substat you already have that feeds the conversion
 *   RequiredStatValueDivider  how much of it one unit of bonus costs
 *   TargetStatType            the substat the fairy grants
 *   TargetStatBonus           the bonus granted per unit at level 1
 *   TargetStatBonusPerLevel   how much that bonus grows per fairy level
 *   TargetStatTotalCap        optional ceiling on the granted total
 *
 * Other facts held back from the page on purpose: fairies unlock at main battle stage 10-1
 * (corroborated by TrackingEventLibrary's lm_battle_10_1 = AgeIdx 9 / BattleIdx 0), a season
 * runs 8 weeks with 3 fairies, upgrades carry over when switching fairy inside a season and
 * reset between seasons.
 * ------------------------------------------------------------------------------------------ */

export default function FairiesWiki() {
    const { selectedVersion } = useGameDataContext();
    const { data: upgrades, loading, error } = useGameData<Record<string, FairyUpgrade>>(
        'FairyUpgradesLibrary.json'
    );
    const [level, setLevel] = usePersistentState<number>('wiki_fairies_selected_level', 1);

    const table = useMemo(() => {
        if (!upgrades) return null;
        const levels = Object.values(upgrades).sort((a, b) => a.Level - b.Level);
        if (!levels.length) return null;
        return {
            levels,
            currencies: levels[0].Costs.map((c) => c.Currency),
            maxLevel: levels[levels.length - 1].Level,
        };
    }, [upgrades]);

    const maxLevel = table?.maxLevel ?? 20;
    const shownLevel = Math.min(Math.max(level, 1), maxLevel);

    /**
     * Per currency: the price of the step that reached this level, and the running total from
     * level 1. Both summed from the real entries so escalating costs would still be correct.
     */
    const rows = useMemo(() => {
        if (!table) return null;
        const step = table.levels.find((l) => l.Level === shownLevel);
        return table.currencies.map((c) => ({
            currency: c,
            perLevel: step?.Costs.find((x) => x.Currency === c)?.Amount ?? 0,
            total: table.levels
                .filter((l) => l.Level <= shownLevel)
                .reduce((sum, l) => sum + (l.Costs.find((x) => x.Currency === c)?.Amount ?? 0), 0),
        }));
    }, [table, shownLevel]);

    const textureBase = `${import.meta.env.BASE_URL}Texture2D/${selectedVersion ?? ''}/`;

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
            <h1 className="text-2xl md:text-3xl font-bold text-accent-primary flex items-center gap-2">
                <Sparkles className="w-7 h-7" /> Fairies
            </h1>

            <Card className="p-4 bg-bg-secondary/50 border-accent-primary/20">
                <div className="flex flex-col md:flex-row md:items-center gap-6">
                    <div className="flex items-center gap-4">
                        <div className="p-2 bg-accent-primary/10 rounded-lg">
                            <Sparkles className="w-8 h-8 text-accent-primary" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-text-primary">Fairy Level</h3>
                            <p className="text-xs text-text-muted">Cost per level and running total</p>
                        </div>
                    </div>

                    <div className="flex-1 flex items-center gap-6">
                        <input
                            type="range"
                            min="1"
                            max={maxLevel}
                            value={shownLevel}
                            onChange={(e) => setLevel(parseInt(e.target.value))}
                            className="flex-1 h-3 bg-bg-input rounded-lg appearance-none cursor-pointer accent-accent-primary"
                        />
                        <div className="min-w-[80px] bg-accent-primary/20 text-accent-primary px-3 py-1.5 rounded-lg font-mono font-bold text-center border border-accent-primary/30">
                            Lv {shownLevel}
                        </div>
                    </div>
                </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {FAIRIES.map((f) => (
                    <Card key={f.name}>
                        <CardContent className="pt-4">
                            <div className="text-center">
                                <img
                                    src={`${textureBase}${f.texture}`}
                                    alt={f.name}
                                    className="w-28 h-28 mx-auto object-contain"
                                />
                                <span className="block mt-1 mb-3 font-semibold text-text-primary text-lg">
                                    {f.name}
                                </span>
                            </div>

                            {loading && <p className="text-xs text-text-secondary">Loading</p>}
                            {error && (
                                <p className="text-xs text-text-secondary">No cost data.</p>
                            )}
                            {rows && (
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-text-muted uppercase tracking-wide border-b border-border">
                                            <th className="text-left font-medium pb-1.5" />
                                            <th className="text-right font-medium pb-1.5">Level</th>
                                            <th className="text-right font-medium pb-1.5">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((r) => {
                                            const meta = CURRENCY[r.currency];
                                            return (
                                                <tr
                                                    key={r.currency}
                                                    className="border-b border-border/40 last:border-0"
                                                >
                                                    <td className="py-1.5">
                                                        <span className="flex items-center gap-1.5 min-w-0">
                                                            {meta && (
                                                                <GameIcon
                                                                    name={meta.icon}
                                                                    size={16}
                                                                    className="shrink-0"
                                                                />
                                                            )}
                                                            <span className="text-text-secondary truncate">
                                                                {meta?.label ?? r.currency}
                                                            </span>
                                                        </span>
                                                    </td>
                                                    <td className="py-1.5 text-right tabular-nums text-text-secondary">
                                                        {r.perLevel ? nf.format(r.perLevel) : '-'}
                                                    </td>
                                                    <td className="py-1.5 text-right tabular-nums text-text-primary font-semibold">
                                                        {nf.format(r.total)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>

            <p className="text-xs text-text-secondary">
                One currency of your choice per upgrade, so the columns are alternatives. Fairy
                bonuses are not published yet.
            </p>
        </div>
    );
}
