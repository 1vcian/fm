import React from 'react';
import { X, Bookmark, Shield, Minus, Plus, Check } from 'lucide-react';
import { ItemSlot, MountSlot, PetSlot } from '../../types/Profile';
import { AscensionStars } from './AscensionStars';
import { cn, getAgeBgStyle, getAgeBorderStyle, getRarityBgStyle, getRarityBorderStyle } from '../../lib/utils';
import { getSkinSpriteStyle } from '../../utils/skinSprites';
import { formatSecondaryStat } from '../../utils/statNames';
import { formatNumber } from '../../utils/format';
import { StatBreakdownTooltip } from './StatBreakdownTooltip';
import { useGameDataContext } from '../../context/GameDataContext';
import { AGES } from '../../utils/constants';

/**
 * ONE artwork size for items, pets, mounts and skills.
 *
 * Every cell in the four families is 256x256 on disk (individual Icon*.png for items, an 8x8 grid
 * in Pets/UltraPets/ApexPets.png, a 4x4 grid in the MountIcons sheets, an 8x8 grid in the SkillIcons
 * sheets). So the honest ceiling before the art starts upscaling is 256 CSS px at 1x, 128 at 2x and
 * 85 at 3x.
 *
 * The frame is therefore 96px up to the md breakpoint and 128px from md up: 96 is sharp on a 3x
 * phone, 128 is 1:1 on the 2x laptops and tablets that see the wider layout. The old card drew 32px.
 */
export const CARD_ART_FRAME_CLASS = 'w-24 h-24 md:w-32 md:h-32';
/** What a panel's renderIcon should put inside that frame: it simply fills it. */
export const CARD_ART_CLASS = 'w-full h-full';

/** Hit target: comfortable with a mouse, finger-sized under a coarse pointer. */
// Smaller on a phone, where two cards share a 390px screen and these buttons sit on the
// same line as the item name. A coarse pointer still gets a finger-sized target.
const TAP = 'w-6 h-6 sm:w-7 sm:h-7 pointer-coarse:w-10 pointer-coarse:h-10';

interface ItemSelectionCardProps {
    item: ItemSlot | MountSlot | PetSlot | any;
    slotKey: string;
    slotLabel: string;
    isSelected?: boolean;
    hasDiff?: boolean;
    /** Marks a saved build that is currently equipped on the active profile. */
    isEquipped?: boolean;
    globalAscensionLevel?: number;
    isSaved?: boolean;
    itemName: string;
    itemImage: string | null;
    stats?: {
        damage: number;
        health: number;
        damageLabel?: string;
        healthLabel?: string;
        bonus?: number;
        damageMulti?: number;
        healthMulti?: number;
        multi?: number;
        skinBonuses?: { damage: number; health: number };
        isMelee?: boolean;
        details?: {
            damage?: {
                base: number;
                levelMulti?: number;
                techMulti?: number;
                clanTechMulti?: number;
                ascMulti?: number;
                skinMulti?: number;
                meleeMulti?: number;
            };
            health?: {
                base: number;
                levelMulti?: number;
                techMulti?: number;
                clanTechMulti?: number;
                ascMulti?: number;
                skinMulti?: number;
            };
        };
    };
    customStats?: React.ReactNode;
    /** Extra chips shown beside the name in the row layout (the pet's Damage/Health/Balanced type). */
    tags?: React.ReactNode;
    perfection?: number | null;
    getStatPerfection?: (statId: string, value: number) => number | null;
    spriteMapping?: any;
    onClick?: () => void;
    onDelete?: (e: React.MouseEvent) => void;
    onUnequip?: (e: React.MouseEvent) => void;
    onSave?: (e: React.MouseEvent) => void;
    onLevelChange?: (delta: number, e: React.MouseEvent) => void;
    onLevelSet?: (newLevel: number) => void;
    onAscensionChange?: (newLevel: number) => void;
    renderIcon?: () => React.ReactNode;
    hideAgeStyles?: boolean;
    rarity?: string;
    variant?: 'default' | 'compact';
    /**
     * 'tile'  the original portrait tile, still what the selector grids want (many small choices).
     * 'row'   artwork-led landscape card for the four loadout panels (one thing you own, up close).
     */
    layout?: 'tile' | 'row';
    currentLevel?: number;
    maxLevel?: number;
    /**
     * Artwork frame size, when the container is tighter than the default 96/128px well.
     * The equipment row packs five cards across, so its artwork has to be smaller than the one
     * the pet and skill panels can afford. Defaults to CARD_ART_FRAME_CLASS.
     */
    artClassName?: string;
    /**
     * Sizing handed down by the container. The loadout panels lay their cards out with
     * `flex flex-wrap`, where the growth factor has to sit on the card itself, so this is how
     * `basis-[...] grow` reaches the root element instead of a wrapper div around it.
     */
    className?: string;
}

export function ItemSelectionCard({
    item,
    slotKey,
    slotLabel,
    isSelected,
    hasDiff,
    isEquipped,
    globalAscensionLevel = 0,
    isSaved,
    itemName,
    itemImage,
    stats,
    customStats,
    tags,
    perfection,
    getStatPerfection,
    spriteMapping,
    onClick,
    onDelete,
    onUnequip,
    onSave,
    onLevelChange,
    onLevelSet,
    onAscensionChange,
    renderIcon,
    hideAgeStyles,
    rarity,
    variant = 'default',
    layout = 'tile',
    currentLevel,
    maxLevel = 299,
    className,
    artClassName,
}: ItemSelectionCardProps) {
    const { selectedVersion } = useGameDataContext();
    const isCompact = variant === 'compact';
    const displayLevel = currentLevel ?? item?.level ?? 0;
    const starSrc = `${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}AscensionStar.png`;

    if (layout === 'row') {
        return (
            <RowCard
                className={className}
                artClassName={artClassName}
                isCompact={isCompact}
                item={item}
                slotKey={slotKey}
                slotLabel={slotLabel}
                isSelected={isSelected}
                hasDiff={hasDiff}
                isEquipped={isEquipped}
                ascensionLevel={globalAscensionLevel}
                isSaved={isSaved}
                itemName={itemName}
                itemImage={itemImage}
                stats={stats}
                customStats={customStats}
                tags={tags}
                perfection={perfection}
                getStatPerfection={getStatPerfection}
                spriteMapping={spriteMapping}
                onClick={onClick}
                onDelete={onDelete}
                onUnequip={onUnequip}
                onSave={onSave}
                onLevelChange={onLevelChange}
                onLevelSet={onLevelSet}
                onAscensionChange={onAscensionChange}
                renderIcon={renderIcon}
                hideAgeStyles={hideAgeStyles}
                rarity={rarity}
                displayLevel={displayLevel}
                maxLevel={maxLevel}
                starSrc={starSrc}
            />
        );
    }

    return (
        <div
            onClick={onClick}
            className={cn(
                "h-full rounded-xl border-2 transition-all relative flex flex-col items-center p-1.5 gap-1 group cursor-pointer",
                isCompact ? "min-h-[130px]" : "min-h-[160px]",
                isSelected
                    ? "border-accent-primary bg-accent-primary/10 shadow-lg shadow-accent-primary/20"
                    : isEquipped
                        ? "border-green-500/60 hover:border-green-400"
                        : "border-border hover:border-accent-primary/50",
                hasDiff && "ring-2 ring-yellow-500 ring-offset-2 ring-offset-bg-primary"
            )}
            style={
                hideAgeStyles
                    ? (rarity ? { background: getRarityBgStyle(rarity).background?.toString().replace('0.5', isSelected ? '0.3' : '0.15').replace('0.2', isSelected ? '0.15' : '0.08') } : { backgroundColor: isSelected ? 'rgba(var(--accent-primary-rgb), 0.2)' : 'var(--bg-secondary)' })
                    : { background: getAgeBgStyle((item as ItemSlot)?.age || 0).background?.toString().replace('0.5', isSelected ? '0.3' : '0.15').replace('0.2', isSelected ? '0.15' : '0.08') }
            }
        >
            {/* Equipped badge */}
            {isEquipped && (
                <div className="absolute top-1 left-1/2 -translate-x-1/2 z-30 flex items-center gap-0.5 bg-green-500 text-white text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shadow-sm border border-green-300/50">
                    <Check className="w-2.5 h-2.5" strokeWidth={3} />
                    Equipped
                </div>
            )}

            {/* Top Row Overlay: Level/Ascension (Left) and Actions (Right) */}
            <div className="w-full px-2 z-20 flex flex-wrap justify-between items-start gap-1 mb-1">
                <div className="flex flex-col gap-1 min-w-0">
                    {/* Level Control */}
                    {onLevelChange ? (
                        <div className="flex items-center gap-1 bg-black/60 px-1.5 py-0.5 rounded backdrop-blur-sm border border-white/10 shrink-0 w-fit" onClick={(e) => e.stopPropagation()}>
                            <button
                                onClick={(e) => onLevelChange(-1, e)}
                                className="p-0.5 hover:bg-white/10 rounded transition-colors"
                            >
                                <Minus className="w-2.5 h-2.5 text-white/70 hover:text-white" />
                            </button>
                            {onLevelSet ? (
                                <div className="flex items-center text-[10px] md:text-[11px] font-bold text-white min-w-[3.5ch]">
                                    <span className="opacity-50 mr-0.5">Lv</span>
                                    <input
                                        type="number"
                                        value={displayLevel}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            if (!isNaN(val)) {
                                                const clamped = Math.max(1, Math.min(maxLevel, val));
                                                onLevelSet(clamped);
                                            } else if (e.target.value === '') {
                                                onLevelSet(0); // Allow clearing to type
                                            }
                                        }}
                                        onBlur={(e) => {
                                            const val = parseInt(e.target.value);
                                            if (isNaN(val) || val < 1) onLevelSet(1);
                                        }}
                                        className="w-full bg-transparent border-none p-0 focus:ring-0 focus:outline-none text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        style={{ width: `${Math.max(2, String(displayLevel).length)}ch` }}
                                    />
                                </div>
                            ) : (
                                <span className="text-[10px] md:text-[11px] font-bold text-white min-w-[3.5ch] text-center tabular-nums">Lv{displayLevel}</span>
                            )}
                            <button
                                onClick={(e) => onLevelChange(1, e)}
                                className="p-0.5 hover:bg-white/10 rounded transition-colors"
                            >
                                <Plus className="w-2.5 h-2.5 text-white/70 hover:text-white" />
                            </button>
                        </div>
                    ) : (
                        <span className="bg-black/60 text-white text-[10px] md:text-[11px] font-bold px-1.5 py-0.5 rounded backdrop-blur-sm border border-white/10 shrink-0 w-fit">
                            Lv{displayLevel}
                        </span>
                    )}

                    {/* Ascension Stars */}
                    {onAscensionChange ? (
                        <div onClick={(e) => e.stopPropagation()}>
                            <AscensionStars
                                value={globalAscensionLevel}
                                onChange={onAscensionChange}
                                size="xs"
                            />
                        </div>
                    ) : globalAscensionLevel > 0 && (
                        <div className="flex gap-0.5 flex-wrap">
                            {Array.from({ length: globalAscensionLevel }).map((_, i) => (
                                <img
                                    key={i}
                                    src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}AscensionStar.png`}
                                    alt="Star"
                                    className="w-2 md:w-2.5 h-2 md:h-2.5 object-contain drop-shadow-sm"
                                />
                            ))}
                        </div>
                    )}
                </div>
                {/* Action Buttons */}
                <div className="flex flex-wrap gap-1 justify-end items-start ml-auto min-w-0">
                    {onSave && (
                        <button
                            onClick={onSave}
                            className={cn(
                                "p-1 rounded-lg transition-all shadow-sm border border-transparent hover:border-border",
                                isSaved ? "bg-accent-primary text-white" : "bg-bg-input text-text-muted hover:text-text-primary"
                            )}
                            title={isSaved ? "Update Saved Preset" : "Save as Preset"}
                        >
                            <Bookmark className={cn("w-3 h-3", isSaved && "fill-white")} />
                        </button>
                    )}
                    {onUnequip && (
                        <button
                            onClick={onUnequip}
                            className="p-1 bg-red-500/80 hover:bg-red-500 rounded-lg transition-all shadow-sm"
                            title="Unequip"
                        >
                            <X className="w-3 h-3 text-white" />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={onDelete}
                            className="p-1 bg-red-500 hover:bg-red-600 rounded-lg transition-all text-white shadow-sm"
                            title="Delete Preset"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* Icon Area */}
            <div className={cn("shrink-0 relative", isCompact ? "mt-1.5" : "mt-4")}>
                <div
                    className={cn(
                        "rounded-lg flex items-center justify-center border-2 shrink-0 bg-bg-primary/50 transition-transform group-hover:scale-110",
                        isCompact ? "w-10 h-10" : "w-12 h-12"
                    )}
                    style={hideAgeStyles
                        ? (rarity ? { ...getRarityBgStyle(rarity), ...getRarityBorderStyle(rarity) } : {})
                        : { ...getAgeBgStyle(typeof (item as any)?.age === 'number' ? (item as any).age : 0), ...getAgeBorderStyle(typeof (item as any)?.age === 'number' ? (item as any).age : 0) }
                    }
                >
                    {renderIcon ? renderIcon() : (
                        itemImage ? (
                            <img
                                src={itemImage}
                                alt={slotLabel}
                                className={cn("object-contain drop-shadow", isCompact ? "w-8 h-8" : "w-10 h-10")}
                            />
                        ) : (
                            <Shield className={cn("text-text-muted opacity-30", isCompact ? "w-6 h-6" : "w-8 h-8")} />
                        )
                    )}
                </div>
                {(item as ItemSlot)?.skin && (
                    <div
                        className="absolute -bottom-1.5 -right-1.5 z-20 w-6 h-6 md:w-8 md:h-8 rounded-md bg-bg-secondary border border-accent-primary shadow-sm overflow-hidden"
                        title={`Skin ID: ${(item as ItemSlot).skin!.idx}`}
                    >
                        <div className="w-full h-full flex items-center justify-center bg-accent-primary/20">
                            <div
                                className="w-full h-full opacity-80"
                                style={getSkinSpriteStyle({
                                    SkinId: {
                                        Idx: (item as ItemSlot).skin!.idx,
                                        Type: (item as ItemSlot).skin!.type || slotKey
                                    }
                                }, spriteMapping?.skins?.mapping, selectedVersion)}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Item Name */}
            <div className="w-full px-1 min-h-[1.5em] flex items-center justify-center mt-1">
                <span className={cn(
                    "font-bold text-center leading-tight select-none text-text-primary",
                    isCompact ? (itemName.length > 20 ? "text-[8px]" : "text-[9px]") : (itemName.length > 20 ? "text-[9px]" : "text-[10px]")
                )}>
                    {itemName}
                </span>
            </div>

            {/* Stats Area */}
            <div className="w-full mt-auto flex flex-col gap-1">
                {stats && (
                    <div className="w-full flex flex-col gap-1">
                        {stats.damage > 0 && (
                            <div className="bg-red-400/10 rounded p-1 border border-red-400/20 flex flex-col items-center group/stats relative">
                                <div className="flex items-center gap-1 text-red-400">
                                    <span className={cn("font-bold uppercase", isCompact ? "text-[8px]" : "text-[10px]")}>{stats.damageLabel || "Damage"}</span>
                                </div>
                                <div className={cn("font-mono font-bold text-red-400 leading-tight", isCompact ? "text-[10px]" : "text-xs")}>
                                    {isCompact ? formatNumber(stats.damage) : Math.round(stats.damage).toLocaleString()}
                                </div>
                                {(stats.multi !== undefined || stats.damageMulti !== undefined || stats.bonus !== undefined) && (
                                    <div className="text-[9px] font-mono font-bold text-text-muted/80 flex items-center justify-center flex-wrap gap-x-1 gap-y-0 mt-0.5 relative">
                                        {(() => {
                                            const m = stats.damageMulti ?? stats.multi;
                                            if (m !== undefined) {
                                                return (
                                                    <>
                                                        <span>x{m.toFixed(2)}</span>
                                                        <span className="text-green-400/80">({((m - 1) * 100).toFixed(1)}%)</span>
                                                    </>
                                                );
                                            }
                                            return (stats.bonus !== undefined) ? (
                                                <span className="text-green-400/80">+{Math.round(stats.bonus * 100)}%</span>
                                            ) : null;
                                        })()}
                                    </div>
                                )}
                                {stats.details?.damage && (
                                    <div className="hidden group-hover/stats:block">
                                        <StatBreakdownTooltip damage={stats.details.damage} isMelee={stats.isMelee} />
                                    </div>
                                )}
                            </div>
                        )}
                        {stats.health > 0 && (
                            <div className="bg-green-400/10 rounded p-1 border border-green-400/20 flex flex-col items-center group/h-stats relative">
                                <div className="flex items-center gap-1 text-green-400">
                                    <span className={cn("font-bold uppercase", isCompact ? "text-[8px]" : "text-[10px]")}>{stats.healthLabel || "Health"}</span>
                                </div>
                                <div className={cn("font-mono font-bold text-green-400 leading-tight", isCompact ? "text-[10px]" : "text-xs")}>
                                    {isCompact ? formatNumber(stats.health) : Math.round(stats.health).toLocaleString()}
                                </div>
                                {(stats.multi !== undefined || stats.healthMulti !== undefined || stats.bonus !== undefined) && (
                                    <div className="text-[9px] font-mono font-bold text-text-muted/80 flex items-center justify-center flex-wrap gap-x-1 gap-y-0 mt-0.5 relative">
                                        {(() => {
                                            const m = stats.healthMulti ?? stats.multi;
                                            if (m !== undefined) {
                                                return (
                                                    <>
                                                        <span>x{m.toFixed(2)}</span>
                                                        <span className="text-green-400/80">({((m - 1) * 100).toFixed(1)}%)</span>
                                                    </>
                                                );
                                            }
                                            return (stats.bonus !== undefined) ? (
                                                <span className="text-green-400/80">+{Math.round(stats.bonus * 100)}%</span>
                                            ) : null;
                                        })()}
                                    </div>
                                )}
                                {stats.details?.health && (
                                    <div className="hidden group-hover/h-stats:block">
                                        <StatBreakdownTooltip health={stats.details.health} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {customStats}
            </div>

            {/* Passive Stats List */}
            {item?.secondaryStats && item.secondaryStats.length > 0 && (
                <div className="w-full grid grid-cols-1 gap-1 mt-1 pt-1 border-t border-border/20">
                    {item.secondaryStats.map((stat: { statId: string; value: number }, idx: number) => {
                        const formatted = formatSecondaryStat(stat.statId, stat.value);
                        const statPerf = getStatPerfection?.(stat.statId, stat.value) ?? null;
                        return (
                            <div key={idx} className={cn("flex flex-col items-center gap-y-0 select-none", isCompact ? "text-[8px] leading-none" : "text-[10px] gap-y-0.5", formatted.color)}>
                                <span className={cn("opacity-80 whitespace-normal text-center", isCompact ? "scale-90" : "leading-[1.1]")}>{formatted.name}</span>
                                <div className="font-bold shrink-0 flex items-center justify-center gap-1 whitespace-nowrap text-center">
                                    <span>{formatted.formattedValue}</span>
                                    {statPerf !== null && (
                                        <div className="flex items-center gap-0.5 group/perf">
                                            <span className={cn("opacity-70", isCompact ? "text-[7px]" : "text-[8px]")}>({Math.round(statPerf)}%)</span>
                                            <div
                                                className={cn("rounded-full bg-gray-700/50 overflow-hidden", isCompact ? "w-0.5 h-2" : "w-0.5 h-2.5")}
                                                title={`Perfection: ${statPerf.toFixed(1)}%`}
                                            >
                                                <div
                                                    className={cn(
                                                        "w-full bg-current opacity-80",
                                                        statPerf >= 90 ? "brightness-125" : "brightness-75"
                                                    )}
                                                    style={{ height: `${statPerf}%`, marginTop: `${100 - statPerf}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Perfection Bar */}
            {perfection != null && (
                <div className="w-full mt-1 flex flex-col gap-0.5 select-none" title={`Perfection: ${perfection.toFixed(1)}%`}>
                    <div className={cn("flex justify-between items-center font-bold text-text-muted", isCompact ? "text-[7px]" : "text-[8px]")}>
                        <span>Perfection</span>
                        <span className={cn(
                            perfection >= 100 ? 'text-yellow-400' :
                                perfection >= 80 ? 'text-green-500' :
                                    perfection >= 50 ? 'text-blue-500' : 'text-gray-400'
                        )}>{perfection.toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden">
                        <div
                            className={cn(
                                "h-full",
                                perfection >= 100 ? 'bg-yellow-400' :
                                    perfection >= 80 ? 'bg-green-500' :
                                        perfection >= 50 ? 'bg-blue-500' : 'bg-gray-500'
                            )}
                            style={{ width: `${Math.min(100, perfection)}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

/* ==========================================================================================
   ROW LAYOUT
   ------------------------------------------------------------------------------------------
   The tile above spends its area on a centred column: a 32px icon, a name, then one line per
   fact, in a box that is mostly horizontal. Measured, that left 89% to 94% of the card empty
   and gave the artwork 1.0% to 1.3% of it.

   This layout keeps every one of those facts and rearranges them around the artwork:
     - the drawing is 96/128px instead of 32px, and it is the first thing in the card
     - level and ascension share one line instead of stacking
     - each stat is one line (label, value, multiplier) instead of three
     - substats are two columns instead of one, so the width that was gutter carries them
     - the perfection label, bar and number share one line

   Age and rarity draw from the same six colours (lib/utils: primitive == common, medieval ==
   rare, and so on), so both are spelled out as text chips. Ascension is drawn as three pips
   plus a count, never as a colour alone.
   ========================================================================================== */

/**
 * The empty counterpart of the row card, so a half-filled panel still reads as one family:
 * same 96/128px artwork well, same left-to-right reading order, same corner radius.
 */
export function EmptyRowCard({
    label, hint, icon, onClick, hasDiff, className, artClassName,
}: {
    label: string;
    hint: string;
    icon?: React.ReactNode;
    onClick?: () => void;
    hasDiff?: boolean;
    className?: string;
    /** Must match the filled card's artwork size or a half-filled row steps up and down. */
    artClassName?: string;
}) {
    return (
        <div
            onClick={onClick}
            className={cn(
                "h-full rounded-xl border-2 border-dashed border-border hover:border-accent-primary/50 bg-bg-input/20 cursor-pointer transition-colors group flex items-center gap-2.5 p-2.5",
                hasDiff && "ring-2 ring-yellow-500 ring-offset-2 ring-offset-bg-primary",
                className
            )}
        >
            <div className={cn(
                "rounded-xl border-2 border-dashed border-border/70 flex items-center justify-center shrink-0 bg-bg-primary/30 opacity-40 group-hover:opacity-70 transition-opacity",
                artClassName || CARD_ART_FRAME_CLASS
            )}>
                {icon || <Plus className="w-8 h-8 text-text-muted" />}
            </div>
            <div className="min-w-0">
                <div className="font-bold text-sm text-text-muted whitespace-nowrap overflow-hidden text-clip">{label}</div>
                <div className="text-[10px] uppercase tracking-widest text-text-muted/60 mt-0.5">{hint}</div>
            </div>
        </div>
    );
}

interface RowCardProps {
    className?: string;
    artClassName?: string;
    /**
     * Comparison mode renders two of these panels side by side, so a card that had the full panel
     * width gets less than half of it. Everything measured in this card scales off this flag.
     */
    isCompact?: boolean;
    item: any;
    slotKey: string;
    slotLabel: string;
    isSelected?: boolean;
    hasDiff?: boolean;
    isEquipped?: boolean;
    ascensionLevel: number;
    isSaved?: boolean;
    itemName: string;
    itemImage: string | null;
    stats?: ItemSelectionCardProps['stats'];
    customStats?: React.ReactNode;
    tags?: React.ReactNode;
    perfection?: number | null;
    getStatPerfection?: (statId: string, value: number) => number | null;
    spriteMapping?: any;
    onClick?: () => void;
    onDelete?: (e: React.MouseEvent) => void;
    onUnequip?: (e: React.MouseEvent) => void;
    onSave?: (e: React.MouseEvent) => void;
    onLevelChange?: (delta: number, e: React.MouseEvent) => void;
    onLevelSet?: (newLevel: number) => void;
    onAscensionChange?: (newLevel: number) => void;
    renderIcon?: () => React.ReactNode;
    hideAgeStyles?: boolean;
    rarity?: string;
    displayLevel: number;
    maxLevel: number;
    starSrc: string;
}

const MAX_ASCENSION = 3;

function RowCard({
    item, slotKey, slotLabel, isSelected, hasDiff, isEquipped, ascensionLevel, isSaved,
    itemName, itemImage, stats, customStats, tags, perfection, getStatPerfection, spriteMapping,
    onClick, onDelete, onUnequip, onSave, onLevelChange, onLevelSet, onAscensionChange,
    renderIcon, hideAgeStyles, rarity, displayLevel, maxLevel, starSrc, className, artClassName,
    isCompact,
}: RowCardProps) {
    // In comparison mode the card is roughly a third of its usual width. Nothing is hidden and
    // nothing is cut with dots: the artwork and the type sizes come down, and the rows below are
    // allowed to wrap so every number stays on screen.
    const artFrame = artClassName || (isCompact ? 'w-12 h-12 sm:w-14 sm:h-14' : CARD_ART_FRAME_CLASS);
    const { selectedVersion } = useGameDataContext();

    const ageIdx = typeof item?.age === 'number' ? (item.age as number) : null;
    const showAge = !hideAgeStyles && ageIdx !== null;
    const rarityName: string | null = rarity || item?.rarity || null;
    const ageColor = showAge ? String(getAgeBorderStyle(ageIdx!).borderColor) : undefined;
    const rarityColor = rarityName ? String(getRarityBorderStyle(rarityName).borderColor) : undefined;

    const cardBg = hideAgeStyles
        ? (rarityName
            ? { background: String(getRarityBgStyle(rarityName).background).replace('0.5', isSelected ? '0.3' : '0.15').replace('0.2', isSelected ? '0.15' : '0.08') }
            : { backgroundColor: isSelected ? 'rgba(var(--accent-primary-rgb), 0.2)' : 'var(--bg-secondary)' })
        : { background: String(getAgeBgStyle(ageIdx ?? 0).background).replace('0.5', isSelected ? '0.3' : '0.15').replace('0.2', isSelected ? '0.15' : '0.08') };

    const frameStyle = hideAgeStyles
        ? (rarityName ? { ...getRarityBgStyle(rarityName), ...getRarityBorderStyle(rarityName) } : {})
        : { ...getAgeBgStyle(ageIdx ?? 0), ...getAgeBorderStyle(ageIdx ?? 0) };

    const substats: { statId: string; value: number }[] = item?.secondaryStats || [];
    const asc = Math.max(0, Math.min(MAX_ASCENSION, ascensionLevel || 0));

    /** label, value, multiplier: one line instead of the three the tile used. */
    const statLine = (
        kind: 'damage' | 'health',
        label: string,
        value: number,
        multi: number | undefined,
        bonus: number | undefined,
        details: any
    ) => {
        const isDmg = kind === 'damage';
        return (
            <div
                className={cn(
                    // No flex-wrap: the three parts of a stat line have to keep the same shape at every
                    // card width, otherwise a narrow card grows a second line and ends up taller
                    // than the card beside it.
                    "relative flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded-md border px-1.5 py-1 min-w-0",
                    isDmg ? "bg-red-400/10 border-red-400/25" : "bg-green-400/10 border-green-400/25",
                    isDmg ? "group/dmg" : "group/hp"
                )}
                title={`${label}: ${Math.round(value).toLocaleString()}`}
            >
                <span className={cn("text-[9px] font-black uppercase tracking-wide shrink-0", isDmg ? "text-red-400" : "text-green-400")}>
                    {label}
                </span>
                <span className={cn("font-mono font-bold text-[13px] leading-none", isDmg ? "text-red-400" : "text-green-400")}>
                    {formatNumber(value)}
                </span>
                {multi !== undefined ? (
                    <span className="font-mono text-[9px] font-bold text-text-muted/90 ml-auto min-w-0">
                        x{multi.toFixed(2)} <span className="text-green-400/80">({((multi - 1) * 100).toFixed(1)}%)</span>
                    </span>
                ) : bonus !== undefined ? (
                    <span className="font-mono text-[9px] font-bold text-green-400/80 ml-auto">+{Math.round(bonus * 100)}%</span>
                ) : null}
                {details && (
                    <div className={cn("hidden", isDmg ? "group-hover/dmg:block" : "group-hover/hp:block")}>
                        {isDmg ? <StatBreakdownTooltip damage={details} isMelee={stats?.isMelee} /> : <StatBreakdownTooltip health={details} />}
                    </div>
                )}
            </div>
        );
    };

    const hasStatLines = !!stats && ((stats.damage ?? 0) > 0 || (stats.health ?? 0) > 0);
    const statLines = hasStatLines ? (
        <>
            {(stats!.damage ?? 0) > 0 && statLine(
                'damage', stats!.damageLabel || 'DMG', stats!.damage,
                stats!.damageMulti ?? stats!.multi, stats!.bonus, stats!.details?.damage
            )}
            {(stats!.health ?? 0) > 0 && statLine(
                'health', stats!.healthLabel || 'HP', stats!.health,
                stats!.healthMulti ?? stats!.multi, stats!.bonus, stats!.details?.health
            )}
        </>
    ) : null;

    return (
        <div
            onClick={onClick}
            className={cn(
                // h-full: the panels stretch every card in a row to the tallest one, and without
                // this the card keeps its content height and leaves a gap under itself instead.
                "h-full rounded-xl border-2 transition-all relative flex flex-col gap-1.5 p-2.5 group cursor-pointer",
                isSelected
                    ? "border-accent-primary shadow-lg shadow-accent-primary/20"
                    : isEquipped
                        ? "border-green-500/60 hover:border-green-400"
                        : "border-border hover:border-accent-primary/50",
                hasDiff && "ring-2 ring-yellow-500 ring-offset-2 ring-offset-bg-primary",
                className
            )}
            style={cardBg}
        >
            {/* ---- header ----
                 The name spans the whole card rather than the strip left of the buttons: beside a
                 96px artwork inside a 264px phone card it only had about 70px and every name over
                 nine characters was clipped, and a clipped name on a touch screen has no tooltip to
                 recover it. Age and rarity are spelled out because they share one six-colour
                 palette (lib/utils: primitive == common, medieval == rare, and so on). */}
            <div className="flex items-start gap-1.5">
                <div className="flex-1 min-w-0 min-h-[1.5em] flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    <span className={cn("font-bold leading-tight text-text-primary min-w-0 break-words", isCompact ? "text-[10px]" : "text-[10px] sm:text-[13px]")} title={itemName}>
                        {itemName}
                    </span>
                    {isEquipped && (
                        <span className="inline-flex items-center gap-0.5 bg-green-500 text-white text-[8px] font-black uppercase tracking-wider px-1 rounded-full">
                            <Check className="w-2.5 h-2.5" strokeWidth={3} />
                            Equipped
                        </span>
                    )}
                    {showAge && (
                        <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: ageColor }} title="Age">
                            {AGES[ageIdx!] || 'Primitive'}
                        </span>
                    )}
                    {rarityName && (
                        <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: rarityColor }} title="Rarity">
                            {rarityName}
                        </span>
                    )}
                    {tags}
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {onSave && (
                        <button
                            onClick={onSave}
                            className={cn(
                                "flex items-center justify-center rounded-lg transition-all border border-transparent hover:border-border", TAP,
                                isSaved ? "bg-accent-primary text-white" : "bg-bg-input text-text-muted hover:text-text-primary"
                            )}
                            title={isSaved ? "Update Saved Preset" : "Save as Preset"}
                        >
                            <Bookmark className={cn("w-3.5 h-3.5", isSaved && "fill-white")} />
                        </button>
                    )}
                    {onUnequip && (
                        <button
                            onClick={onUnequip}
                            className={cn("flex items-center justify-center bg-red-500/80 hover:bg-red-500 rounded-lg transition-all", TAP)}
                            title="Unequip"
                        >
                            <X className="w-3.5 h-3.5 text-white" />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={onDelete}
                            className={cn("flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-lg transition-all", TAP)}
                            title="Delete Preset"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* ---- artwork + the numbers that belong to it ---- */}
            <div className="flex items-start gap-2.5 min-w-0">
                {/* THE ARTWORK. 96px, 128px from md up. */}
                <div className="relative shrink-0">
                    <div
                        className={cn(
                            "rounded-xl border-2 p-1 flex items-center justify-center bg-bg-primary/50 shadow-inner overflow-hidden transition-transform group-hover:scale-[1.03]",
                            artFrame
                        )}
                        style={frameStyle}
                    >
                        {renderIcon ? renderIcon() : (
                            itemImage ? (
                                <img src={itemImage} alt={slotLabel} className="w-full h-full object-contain drop-shadow" />
                            ) : (
                                <Shield className="w-8 h-8 text-text-muted opacity-30" />
                            )
                        )}
                    </div>
                    {item?.skin && (
                        <div
                            className="absolute -bottom-1.5 -right-1.5 z-20 w-8 h-8 rounded-lg bg-bg-secondary border border-accent-primary shadow-md overflow-hidden"
                            title={`Skin ID: ${item.skin.idx}`}
                        >
                            <div className="w-full h-full flex items-center justify-center bg-accent-primary/20">
                                <div
                                    className="w-full h-full opacity-90"
                                    style={getSkinSpriteStyle(
                                        { SkinId: { Idx: item.skin.idx, Type: item.skin.type || slotKey } },
                                        spriteMapping?.skins?.mapping,
                                        selectedVersion
                                    )}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* ---- level, ascension and the main stats, beside the artwork ----
                     justify-between because the artwork sets this row's height: when the text side
                     is shorter than the frame the slack is shared out instead of collecting into one
                     void above the substats. */}
                <div className="flex-1 min-w-0 flex flex-col justify-between gap-1">
                    {/* level and ascension, one line */}
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
                        {onLevelChange ? (
                            <div
                                className="flex items-center gap-0.5 bg-black/50 rounded-lg border border-white/10 p-0.5"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <button
                                    onClick={(e) => onLevelChange(-1, e)}
                                    className={cn("flex items-center justify-center rounded-md hover:bg-white/10 transition-colors", TAP)}
                                    title="Level down"
                                >
                                    <Minus className="w-3.5 h-3.5 text-white/80" />
                                </button>
                                {onLevelSet ? (
                                    <div className="flex items-center text-[12px] font-bold text-white tabular-nums">
                                        <span className="opacity-50 text-[10px]">Lv</span>
                                        <input
                                            type="number"
                                            value={displayLevel}
                                            aria-label="Level"
                                            title="Level"
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val)) onLevelSet(Math.max(1, Math.min(maxLevel, val)));
                                                else if (e.target.value === '') onLevelSet(0);
                                            }}
                                            onBlur={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (isNaN(val) || val < 1) onLevelSet(1);
                                            }}
                                            className={cn(
                                                "bg-transparent border-none px-1 focus:ring-0 focus:outline-none text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                                // The inline width below sizes the field to the digits;
                                                // min-width clamps it back up to a finger on a phone.
                                                "h-7 pointer-coarse:h-10 min-w-[3ch] pointer-coarse:min-w-10"
                                            )}
                                            style={{ width: `${Math.max(3, String(displayLevel).length + 1)}ch` }}
                                        />
                                    </div>
                                ) : (
                                    <span className="px-1 text-[12px] font-bold text-white tabular-nums">Lv{displayLevel}</span>
                                )}
                                <button
                                    onClick={(e) => onLevelChange(1, e)}
                                    className={cn("flex items-center justify-center rounded-md hover:bg-white/10 transition-colors", TAP)}
                                    title="Level up"
                                >
                                    <Plus className="w-3.5 h-3.5 text-white/80" />
                                </button>
                            </div>
                        ) : (
                            <span className="bg-black/50 text-white text-[12px] font-bold px-2 py-1 rounded-lg border border-white/10 tabular-nums">
                                Lv{displayLevel}
                            </span>
                        )}

                        {onAscensionChange ? (
                            <div onClick={(e) => e.stopPropagation()}>
                                <AscensionStars value={asc} onChange={onAscensionChange} size="xs" className="origin-left scale-[0.8] sm:scale-90 xl:scale-100" />
                            </div>
                        ) : (
                            <div
                                className="flex items-center gap-0.5 bg-amber-500/10 border border-amber-500/25 rounded-lg px-1.5 py-1"
                                title={`Ascension: ${asc} of ${MAX_ASCENSION} stars`}
                            >
                                {Array.from({ length: MAX_ASCENSION }).map((_, i) => (
                                    <img
                                        key={i}
                                        src={starSrc}
                                        alt=""
                                        className={cn("w-3 h-3 object-contain", i < asc ? "drop-shadow" : "opacity-25 grayscale")}
                                    />
                                ))}
                                <span className="text-[10px] font-bold text-amber-400 tabular-nums ml-0.5">{asc}</span>
                            </div>
                        )}
                    </div>

                    {/* Beside the artwork from 640px up, where there is width for it. */}
                    {hasStatLines && <div className="hidden sm:flex flex-col gap-1">{statLines}</div>}
                </div>
            </div>

            {/* On a phone the same block sits under the artwork instead of beside it. Two cards
                across a 390px screen leave each one about 159px, and a stat line squeezed into the
                column right of a 64px drawing had to wrap its multiplier onto a third line while
                the area under the drawing stayed empty. Full width here uses that space and keeps
                every figure on one line. */}
            {hasStatLines && <div className="flex sm:hidden flex-col gap-1">{statLines}</div>}

            {/* ---- caller-supplied block (skill damage / timings) ---- */}
            {customStats}

            {/* ---- substats, two columns ---- */}
            {substats.length > 0 && (
                <div className={cn(
                    'grid gap-x-2 gap-y-0.5 pt-1.5 border-t border-border/25',
                    // One column while the card is narrow: two 72px cells cannot hold
                    // "+36.4% (91%)" without spilling past the card's own border.
                    isCompact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
                )}>
                    {substats.map((stat, idx) => {
                        const formatted = formatSecondaryStat(stat.statId, stat.value);
                        const statPerf = getStatPerfection?.(stat.statId, stat.value) ?? null;
                        return (
                            <div key={idx} className={cn("flex items-center gap-1 text-[9px] leading-tight select-none min-w-0", formatted.color)}>
                                <span className="min-w-0 opacity-80 break-words" title={formatted.name}>{formatted.name}</span>
                                <span className="font-bold ml-auto">{formatted.formattedValue}</span>
                                {statPerf !== null && (
                                    <>
                                        <span className="opacity-70 text-[8px]">({Math.round(statPerf)}%)</span>
                                        <div
                                            className="rounded-full bg-gray-700/50 overflow-hidden w-0.5 h-2.5 shrink-0"
                                            title={`Perfection: ${statPerf.toFixed(1)}%`}
                                        >
                                            <div
                                                className={cn("w-full bg-current opacity-80", statPerf >= 90 ? "brightness-125" : "brightness-75")}
                                                style={{ height: `${statPerf}%`, marginTop: `${100 - statPerf}%` }}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ---- perfection: label, bar and number on one line ---- */}
            {perfection != null && (
                <div className="flex items-center gap-1.5 select-none" title={`Perfection: ${perfection.toFixed(1)}%`}>
                    <span className="text-[8px] font-bold uppercase tracking-wider text-text-muted shrink-0">Perfection</span>
                    <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div
                            className={cn(
                                "h-full",
                                perfection >= 100 ? 'bg-yellow-400' :
                                    perfection >= 80 ? 'bg-green-500' :
                                        perfection >= 50 ? 'bg-blue-500' : 'bg-gray-500'
                            )}
                            style={{ width: `${Math.min(100, perfection)}%` }}
                        />
                    </div>
                    <span className={cn(
                        "text-[9px] font-bold tabular-nums shrink-0",
                        perfection >= 100 ? 'text-yellow-400' :
                            perfection >= 80 ? 'text-green-500' :
                                perfection >= 50 ? 'text-blue-500' : 'text-gray-400'
                    )}>{perfection.toFixed(1)}%</span>
                </div>
            )}
        </div>
    );
}
