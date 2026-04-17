import React from 'react';
import { X, Bookmark, Shield, Minus, Plus } from 'lucide-react';
import { ItemSlot, MountSlot, PetSlot } from '../../types/Profile';
import { AscensionStars } from './AscensionStars';
import { cn, getAgeBgStyle, getAgeBorderStyle, getRarityBgStyle, getRarityBorderStyle } from '../../lib/utils';
import { getSkinSpriteStyle } from '../../utils/skinSprites';
import { formatSecondaryStat } from '../../utils/statNames';
import { formatNumber } from '../../utils/format';

interface ItemSelectionCardProps {
    item: ItemSlot | MountSlot | PetSlot | any;
    slotKey: string;
    slotLabel: string;
    isSelected?: boolean;
    hasDiff?: boolean;
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
    };
    customStats?: React.ReactNode;
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
    currentLevel?: number;
    maxLevel?: number;
}

export function ItemSelectionCard({
    item,
    slotKey,
    slotLabel,
    isSelected,
    hasDiff,
    globalAscensionLevel = 0,
    isSaved,
    itemName,
    itemImage,
    stats,
    customStats,
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
    currentLevel,
    maxLevel = 299
}: ItemSelectionCardProps) {
    const isCompact = variant === 'compact';
    const displayLevel = currentLevel ?? item?.level ?? 0;

    return (
        <div
            onClick={onClick}
            className={cn(
                "h-full rounded-xl border-2 transition-all relative flex flex-col items-center p-1.5 gap-1 group cursor-pointer",
                isCompact ? "min-h-[130px]" : "min-h-[160px]",
                isSelected 
                    ? "border-accent-primary bg-accent-primary/10 shadow-lg shadow-accent-primary/20" 
                    : "border-border hover:border-accent-primary/50",
                hasDiff && "ring-2 ring-yellow-500 ring-offset-2 ring-offset-bg-primary"
            )}
            style={
                !isSelected ? (
                    hideAgeStyles 
                        ? (rarity ? { background: getRarityBgStyle(rarity).background?.toString().replace('0.3', '0.1').replace('0.1', '0.05') } : { backgroundColor: 'var(--bg-secondary)' })
                        : { background: getAgeBgStyle((item as ItemSlot)?.age || 0).background?.toString().replace('0.3', '0.1').replace('0.1', '0.05') }
                ) : {}
            }
        >
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
                                    src={`${import.meta.env.BASE_URL}Texture2D/AscensionStar.png`} 
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
                                }, spriteMapping?.skins?.mapping)}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Item Name */}
            <div className="w-full px-1 min-h-[1.5em] flex items-center justify-center mt-1">
                <span className={cn(
                    "font-bold text-center leading-tight select-none",
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
                            <div className="bg-red-400/10 rounded p-1 border border-red-400/20 flex flex-col items-center">
                                <div className="flex items-center gap-1 text-red-400">
                                    <span className={cn("font-bold uppercase", isCompact ? "text-[8px]" : "text-[10px]")}>{stats.damageLabel || "Damage"}</span>
                                </div>
                                <div className={cn("font-mono font-bold text-red-400 leading-tight", isCompact ? "text-[10px]" : "text-xs")}>
                                    {isCompact ? formatNumber(stats.damage) : Math.round(stats.damage).toLocaleString()}
                                </div>
                                {(stats.multi !== undefined || stats.damageMulti !== undefined || stats.bonus !== undefined) && (
                                    <div className="text-[9px] font-mono font-bold text-text-muted/80 flex items-center justify-center flex-wrap gap-x-1 gap-y-0 mt-0.5">
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
                            </div>
                        )}
                        {stats.health > 0 && (
                            <div className="bg-green-400/10 rounded p-1 border border-green-400/20 flex flex-col items-center">
                                <div className="flex items-center gap-1 text-green-400">
                                    <span className={cn("font-bold uppercase", isCompact ? "text-[8px]" : "text-[10px]")}>{stats.healthLabel || "Health"}</span>
                                </div>
                                <div className={cn("font-mono font-bold text-green-400 leading-tight", isCompact ? "text-[10px]" : "text-xs")}>
                                    {isCompact ? formatNumber(stats.health) : Math.round(stats.health).toLocaleString()}
                                </div>
                                {(stats.multi !== undefined || stats.healthMulti !== undefined || stats.bonus !== undefined) && (
                                    <div className="text-[9px] font-mono font-bold text-text-muted/80 flex items-center justify-center flex-wrap gap-x-1 gap-y-0 mt-0.5">
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
