import { cn } from '../../lib/utils';

/**
 * One stat's breakdown for the hover tooltip. Every multiplier field uses ONE convention:
 *
 *   techMulti, clanTechMulti, itemMulti   bonus as a fraction (0.25 = +25%), shown as x(1 + v)
 *   levelMulti, meleeMulti, ascMulti,     full factor (1.6 = x1.6), shown as is
 *   skinMulti, commonMulti, skillMulti,
 *   total
 *
 * techMulti is the PERSONAL tree only. Since 2026_10 the clan copy of a Damage/Health
 * Multiplier node sits in its own StatLayer (ClanTechTree, ToClanLayer 0x78227C8), so the clan
 * tree is a separate x(1 + clan) factor, never folded into techMulti. Use personalTechShare()
 * from utils/clanTechStacking to split a merged modifier.
 */
export interface StatBreakdown {
    base: number;
    levelMulti?: number;
    techMulti?: number;
    clanTechMulti?: number;
    itemMulti?: number;
    ascMulti?: number;
    commonMulti?: number;
    skillMulti?: number;
    total?: number;
    skinMulti?: number;
    meleeMulti?: number;
}

interface StatBreakdownTooltipProps {
    damage?: StatBreakdown;
    health?: StatBreakdown;
    isMelee?: boolean;
}

const formatBonusFactor = (bonus: number) => `×${(1 + bonus).toFixed(3)} (+${(bonus * 100).toFixed(1)}%)`;
const formatMulti = (val: number) => `×${val.toFixed(2)}`;

function Row({ label, value, className }: { label: string; value: string; className: string }) {
    return (
        <div className="flex justify-between gap-2">
            <span className="text-text-muted">{label}</span>
            <span className={className}>{value}</span>
        </div>
    );
}

function BreakdownSection({ data, label, color }: { data: StatBreakdown; label: string; color: string }) {
    const tech = data.techMulti ?? 0;
    const clan = data.clanTechMulti ?? 0;
    const items = data.itemMulti ?? 0;
    const asc = data.ascMulti ?? 1;
    const level = data.levelMulti ?? 1;
    const melee = data.meleeMulti ?? 1;
    const skin = data.skinMulti ?? 1;
    const common = data.commonMulti ?? 1;

    // Product of every layer shown, so the total always matches the lines above it.
    const total = data.total ?? (level * melee * (1 + tech) * (1 + clan) * (1 + items) * asc * skin * common);

    return (
        <div>
            <div className={cn("text-[10px] font-black uppercase tracking-tighter mb-1 border-b pb-0.5", `text-${color}-400 border-${color}-400/20`)}>{label} Breakdown</div>
            <div className="space-y-1 text-[10px] font-mono">
                <Row label="Base Value" value={data.base.toFixed(1)} className="text-white" />
                {level > 1 && <Row label="Level Scaling" value={formatMulti(level)} className="text-blue-400" />}
                {melee > 1 && <Row label="Melee Weapon" value={formatMulti(melee)} className="text-blue-400" />}
                {tech > 0 && <Row label="Tech Tree" value={formatBonusFactor(tech)} className="text-green-400" />}
                {clan > 0 && <Row label="Clan Tree" value={formatBonusFactor(clan)} className="text-purple-300" />}
                {items > 0 && <Row label="Skill Substats" value={formatBonusFactor(items)} className="text-green-400" />}
                {asc > 1 && <Row label="Ascension" value={formatMulti(asc)} className="text-amber-400" />}
                {skin > 1 && <Row label="Skin Bonus" value={formatMulti(skin)} className="text-pink-400" />}
                {data.skillMulti !== undefined && (
                    <Row label="= Skill Multi" value={data.skillMulti.toFixed(2)} className="text-blue-300 font-bold" />
                )}
                {common !== 1 && <Row label="Damage/Health %" value={formatMulti(common)} className="text-orange-400 font-bold" />}
                <div className="flex justify-between border-t border-white/10 pt-1 mt-1">
                    <span className="text-white/60 font-bold">Total</span>
                    <span className="text-white font-bold">{formatMulti(total)}</span>
                </div>
            </div>
        </div>
    );
}

export function StatBreakdownTooltip({ damage, health }: StatBreakdownTooltipProps) {
    return (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-black/95 backdrop-blur-md border border-white/10 rounded-lg p-3 shadow-2xl z-[100] pointer-events-none animate-in fade-in zoom-in duration-200">
            <div className="space-y-3">
                {damage && <BreakdownSection data={damage} label="Damage" color="red" />}
                {health && <BreakdownSection data={health} label="Health" color="green" />}
            </div>
            <div className="mt-2 pt-2 border-t border-white/10 text-[8px] text-text-muted italic text-center">
                Each line is its own game layer: they multiply.
            </div>
        </div>
    );
}
