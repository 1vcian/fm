import React, { useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { Emblem, describeEmblem, useEmblemArtVersion, useEmblemColors, useEmblemImage } from './Emblem';
import {
    BADGE_ICON_COUNT,
    BADGE_SHAPE_COUNT,
    type ClanBadge as ClanBadgeValue,
    badgeIconName,
    badgeSelection,
    badgeShapeName,
    badgeToCode,
    clampBadge,
    normalizeBadgeColors,
    randomBadge,
} from '../../utils/clanBadge';
import {
    EMBLEM_ICON_SHEET,
    EMBLEM_SHAPE_SHEET,
    type GuildEmblemColor,
    emblemCellBackground,
    emblemColorLabel,
} from '../../utils/emblem';

export type { ClanBadgeValue };

/* -------------------------------------------------------------------------- */
/* ClanBadge                                                                  */
/* -------------------------------------------------------------------------- */

export interface ClanBadgeProps {
    /** Anything: a partial row, null, out-of-range numbers. It gets clamped. */
    badge: Partial<ClanBadgeValue> | null | undefined;
    /** Rendered edge in px. 24 for list rows, 32 default, 64+ for detail. */
    size?: number;
    /** Force a texture version; defaults to the app's selected one. */
    version?: string | null;
    /** Accessible name; defaults to a description of the badge itself. */
    label?: string;
    className?: string;
    title?: string;
}

/**
 * A clan's emblem, drawn exactly like the in-game one and exactly like the
 * Emblems designer page: holder banner, tinted shape, tinted symbol, composed
 * by the single renderer in src/utils/emblem.ts.
 *
 * This is a thin adapter — it turns the four `clans` columns into an
 * <Emblem> selection and supplies the cosmetic shape/symbol names for the
 * accessible label. All the drawing lives in <Emblem>.
 */
export const ClanBadge: React.FC<ClanBadgeProps> = ({
    badge,
    size = 32,
    version,
    label,
    className,
    title,
}) => {
    const b = useMemo(() => clampBadge(badge), [badge]);
    return (
        <Emblem
            {...badgeSelection(b)}
            size={size}
            version={version}
            label={label}
            title={title}
            className={className}
            shapeName={badgeShapeName(b.shape)}
            iconName={badgeIconName(b.icon)}
        />
    );
};

/* -------------------------------------------------------------------------- */
/* ClanBadgePicker                                                            */
/* -------------------------------------------------------------------------- */

type PickerTab = 'shape' | 'icon';

/** Columns in the shape/symbol tile grids. Mirrors the `grid-cols-8` class. */
const PICKER_COLS = 8;

/**
 * KEYBOARD MODEL — roving tabindex, not one tab stop per tile.
 *
 * The picker holds a 16-tile grid, a 64-tile grid and a swatch row. If every
 * tile were a tab stop, tabbing past the picker would take ~70 presses, which
 * makes the rest of a form unreachable in practice. So each group is a
 * `radiogroup`: exactly one tile (the selected one) has tabIndex 0, the arrow
 * keys move the selection — and therefore the live preview — inside the group,
 * and Tab leaves the group entirely. That is the WAI-ARIA radio-group pattern,
 * and it is also the nicer interaction: hold ArrowRight and watch the badge
 * morph. Either tab exposes 5 stops: the grid, the swatch row, the two tab
 * buttons and Random.
 *
 * `cols` is the visual column count so ArrowUp/ArrowDown move a whole row. The
 * swatch row passes cols = 1, where up/down are simply prev/next.
 */
function useRovingGrid(
    cols: number,
    count: number,
    selected: number,
    onSelect: (index: number) => void,
) {
    const ref = React.useRef<HTMLDivElement | null>(null);

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const next: Record<string, number | undefined> = {
            ArrowRight: selected + 1,
            ArrowLeft: selected - 1,
            ArrowDown: selected + cols,
            ArrowUp: selected - cols,
            Home: 0,
            End: count - 1,
        };
        const target = next[e.key];
        if (target === undefined) return;
        e.preventDefault();
        // clamp instead of wrapping: wrapping a 64-cell grid at the edges is
        // disorienting, and clamping keeps Home/End meaningful.
        const i = Math.max(0, Math.min(count - 1, target));
        if (i !== selected) onSelect(i);
        ref.current?.querySelectorAll<HTMLElement>('[data-tile]')[i]?.focus();
    };

    return { ref, onKeyDown };
}

interface SwatchRowProps {
    /** The colours the CONFIG offers for this layer — 7 Background or 2 Foreground. */
    options: readonly GuildEmblemColor[];
    /** Selected ColorId. */
    selected: number;
    onSelect: (colorId: number) => void;
    label: string;
}

/**
 * One row of colour swatches, straight from GuildEmblemColors.json.
 *
 * The roving index walks POSITIONS in `options`; the value emitted is always
 * the game's ColorId, so what the picker stores is what the config defines.
 * Labels are the derived hue name plus the hex (the config gives colours no
 * name, and the app's existing emblem UI identifies them by hex).
 */
const SwatchRow: React.FC<SwatchRowProps> = ({ options, selected, onSelect, label }) => {
    const at = Math.max(0, options.findIndex(c => c.ColorId === selected));
    const grid = useRovingGrid(1, options.length, at, i => onSelect(options[i].ColorId));
    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-wide text-text-muted">
                <span>{label}</span>
                <span className="font-mono lowercase">{options[at]?.HexCode ?? ''}</span>
            </div>
            <div
                ref={grid.ref}
                onKeyDown={grid.onKeyDown}
                role="radiogroup"
                aria-label={label}
                className="flex flex-wrap gap-1.5"
            >
                {options.map(color => (
                    <button
                        key={color.ColorId}
                        data-tile
                        type="button"
                        role="radio"
                        onClick={() => onSelect(color.ColorId)}
                        aria-label={`${emblemColorLabel(color.HexCode)} ${color.HexCode}`}
                        aria-checked={selected === color.ColorId}
                        tabIndex={selected === color.ColorId ? 0 : -1}
                        title={color.HexCode}
                        className={cn(
                            'h-6 w-6 rounded-md border transition-transform',
                            'hover:scale-110 focus:outline-none focus:ring-2 focus:ring-accent-primary/60',
                            selected === color.ColorId
                                ? 'border-white ring-2 ring-accent-primary/70'
                                // a light hairline so a dark swatch (#5A5A5A) is
                                // still visible against the near-black card
                                : 'border-white/25',
                        )}
                        style={{ backgroundColor: color.HexCode }}
                    />
                ))}
            </div>
        </div>
    );
};

export interface ClanBadgePickerProps {
    value: Partial<ClanBadgeValue> | null | undefined;
    onChange: (badge: ClanBadgeValue) => void;
    /** Hide the "Random" button (e.g. read-only-ish flows). */
    allowRandom?: boolean;
    /** Show the 5-character shareable code under the preview. Default true. */
    showCode?: boolean;
    disabled?: boolean;
    version?: string | null;
    className?: string;
}

/**
 * 16 shapes x 64 symbols x the colours the game ships — 7 Background ids for
 * the shape and 2 Foreground ids for the symbol, read from
 * GuildEmblemColors.json, so the picker cannot offer a colour the game does not
 * have or a colour on the wrong layer.
 *
 * Tiles show the raw greyscale atlas cell, the same way the Emblems designer
 * page does: a tile answers "which shape", and the tinted answer to "which
 * colour" is the live preview at the top.
 *
 * Purely presentational: value + onChange, no fetching, no clan knowledge.
 */
export const ClanBadgePicker: React.FC<ClanBadgePickerProps> = ({
    value,
    onChange,
    allowRandom = true,
    showCode = true,
    disabled = false,
    version,
    className,
}) => {
    const colors = useEmblemColors();
    const artVersion = useEmblemArtVersion(version);
    const [tab, setTab] = useState<PickerTab>('shape');

    // Normalise on the way in as well as on the way out: a legacy row can hold
    // a colour id the game no longer defines, and the picker must show which
    // swatch is actually selected rather than none of them.
    const badge = useMemo(
        () => normalizeBadgeColors(clampBadge(value), colors),
        [value, colors],
    );
    const { composition } = useEmblemImage(badgeSelection(badge), 64, { version });

    const emit = (patch: Partial<ClanBadgeValue>) => {
        if (disabled) return;
        onChange(normalizeBadgeColors(clampBadge({ ...badge, ...patch }), colors));
    };

    // Both hooks run every render (only one grid is mounted at a time, but a
    // hook may not be conditional). PICKER_COLS must match the `grid-cols-8`
    // literal on the grids below — tailwind cannot see an interpolated class,
    // so the number is written twice on purpose.
    const shapeGrid = useRovingGrid(PICKER_COLS, BADGE_SHAPE_COUNT, badge.shape, i => emit({ shape: i }));
    const iconGrid = useRovingGrid(PICKER_COLS, BADGE_ICON_COUNT, badge.icon, i => emit({ icon: i }));

    const tileClass = (active: boolean) => cn(
        'flex aspect-square items-center justify-center rounded-lg border bg-white/[0.06] p-1 transition-colors',
        active
            ? 'border-accent-primary ring-1 ring-accent-primary'
            : 'border-border hover:border-accent-primary/40',
    );

    const tabButton = (id: PickerTab, text: string) => (
        <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={cn(
                'h-8 rounded-lg px-3 text-xs font-medium transition-colors',
                tab === id
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'text-text-secondary hover:bg-white/5 hover:text-text-primary',
            )}
        >
            {text}
        </button>
    );

    return (
        <div
            className={cn(
                'rounded-xl border border-border bg-bg-card p-3',
                disabled && 'pointer-events-none opacity-60',
                className,
            )}
        >
            {/* Preview + identity */}
            <div className="mb-3 flex items-center gap-3">
                <div className="rounded-lg bg-bg-input p-2">
                    <ClanBadge badge={badge} size={64} version={version} />
                </div>
                <div className="min-w-0">
                    <div className="whitespace-nowrap overflow-hidden text-clip text-sm text-text-primary">
                        {describeEmblem(composition, badgeShapeName(badge.shape), badgeIconName(badge.icon))}
                    </div>
                    {showCode && (
                        <div className="mt-0.5 font-mono text-xs tracking-[0.2em] text-accent-primary">
                            {badgeToCode(badge)}
                        </div>
                    )}
                    <div className="mt-1 flex items-center gap-3">
                        <ClanBadge badge={badge} size={24} version={version} />
                        <ClanBadge badge={badge} size={32} version={version} />
                        {allowRandom && (
                            <button
                                type="button"
                                onClick={() => emit(randomBadge(colors))}
                                className="h-7 rounded-lg border border-border px-2 text-[11px] text-text-secondary hover:border-accent-primary/50 hover:text-text-primary"
                            >
                                Random
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="mb-2 flex gap-1">
                {tabButton('shape', 'Shape')}
                {tabButton('icon', 'Symbol')}
            </div>

            {tab === 'shape' ? (
                <div className="space-y-3">
                    <div
                        ref={shapeGrid.ref}
                        onKeyDown={shapeGrid.onKeyDown}
                        role="radiogroup"
                        aria-label="Badge shape"
                        className="grid grid-cols-8 gap-1.5"
                    >
                        {Array.from({ length: BADGE_SHAPE_COUNT }, (_, i) => (
                            <button
                                key={i}
                                data-tile
                                type="button"
                                role="radio"
                                onClick={() => emit({ shape: i })}
                                aria-checked={badge.shape === i}
                                aria-label={badgeShapeName(i)}
                                tabIndex={badge.shape === i ? 0 : -1}
                                title={badgeShapeName(i)}
                                className={tileClass(badge.shape === i)}
                            >
                                <span
                                    aria-hidden="true"
                                    className="h-full w-full bg-no-repeat opacity-80"
                                    style={emblemCellBackground(EMBLEM_SHAPE_SHEET, i, artVersion)}
                                />
                            </button>
                        ))}
                    </div>
                    <SwatchRow
                        label="Shape color"
                        options={colors.background}
                        selected={badge.shapeColor}
                        onSelect={colorId => emit({ shapeColor: colorId })}
                    />
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="custom-scrollbar max-h-64 overflow-y-auto pr-1">
                        <div
                            ref={iconGrid.ref}
                            onKeyDown={iconGrid.onKeyDown}
                            role="radiogroup"
                            aria-label="Badge symbol"
                            className="grid grid-cols-8 gap-1.5"
                        >
                            {Array.from({ length: BADGE_ICON_COUNT }, (_, i) => (
                                <button
                                    key={i}
                                    data-tile
                                    type="button"
                                    role="radio"
                                    onClick={() => emit({ icon: i })}
                                    aria-checked={badge.icon === i}
                                    tabIndex={badge.icon === i ? 0 : -1}
                                    title={badgeIconName(i)}
                                    aria-label={badgeIconName(i)}
                                    className={tileClass(badge.icon === i)}
                                >
                                    <span
                                        aria-hidden="true"
                                        className="h-full w-full bg-no-repeat opacity-90"
                                        style={emblemCellBackground(EMBLEM_ICON_SHEET, i, artVersion)}
                                    />
                                </button>
                            ))}
                        </div>
                    </div>
                    <SwatchRow
                        label="Symbol color"
                        options={colors.foreground}
                        selected={badge.iconColor}
                        onSelect={colorId => emit({ iconColor: colorId })}
                    />
                </div>
            )}

            <div className="mt-2 text-[11px] text-text-muted">
                {BADGE_SHAPE_COUNT} shapes x {BADGE_ICON_COUNT} symbols x{' '}
                {colors.background.length} shape colors x {colors.foreground.length} symbol colors
            </div>
        </div>
    );
};

export default ClanBadge;
