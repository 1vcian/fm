import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { useGameData } from '../../hooks/useGameData';
import { useGameDataContext } from '../../context/GameDataContext';
import {
    type EmblemColors,
    type EmblemComposition,
    type EmblemSelection,
    type EmblemSheets,
    type GuildEmblemColor,
    EMPTY_EMBLEM_COLORS,
    emblemColorLabel,
    emblemComposition,
    emblemDataUrl,
    indexEmblemColors,
    loadEmblemSheets,
    resolveEmblemArtVersion,
} from '../../utils/emblem';

/**
 * React face of src/utils/emblem.ts: the hooks that get the game's colours and
 * sprite sheets into a component, and <Emblem>, the one thing that puts an
 * emblem on screen. src/pages/Emblems.tsx and <ClanBadge> both sit on these.
 *
 * <Emblem> renders an <img> rather than a live canvas: the composed PNG is
 * memoised per (cells, hexes, pixel size) in utils/emblem.ts, so a roster of 40
 * clans sharing a handful of badges composes each of them once, and the DOM
 * stays one element per emblem.
 */

/* -------------------------------------------------------------------------- */
/* Hooks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * GuildEmblemColors.json, through the app's own config loader — same path,
 * same cache and same version selection as every other config in the app, so
 * an emblem colour can never be a value this codebase chose.
 *
 * Requires a GameDataProvider above it (useGameData reads selectedVersion from
 * it). That is not a limitation worth working around: an emblem cannot be drawn
 * without game data, so a missing provider is a wiring bug and should say so.
 */
export function useEmblemColors(): EmblemColors {
    const { data } = useGameData<Record<string, GuildEmblemColor>>('GuildEmblemColors.json');
    return useMemo(() => (data ? indexEmblemColors(data) : EMPTY_EMBLEM_COLORS), [data]);
}

/**
 * Which Texture2D/ folder to draw from: the app's selected version when it
 * ships the emblem sheets, otherwise the newest one that does (10 of the 23
 * config versions have no Texture2D/ folder at all, and a 404 on an <img> is
 * silent). `override` is for a caller that wants a specific version.
 */
export function useEmblemArtVersion(override?: string | null): string {
    const { selectedVersion } = useGameDataContext();
    return resolveEmblemArtVersion(override ?? selectedVersion);
}

/** The three decoded sheets for a version, or null until they are ready. */
export function useEmblemSheets(version?: string | null): EmblemSheets | null {
    const [sheets, setSheets] = useState<EmblemSheets | null>(null);

    useEffect(() => {
        let live = true;
        loadEmblemSheets(version)
            .then(s => { if (live) setSheets(s); })
            .catch(() => { if (live) setSheets(null); });
        return () => { live = false; };
    }, [version]);

    return sheets;
}

/**
 * Device pixel ratio, kept current.
 *
 * This is what keeps a 24px badge in a roster crisp: the emblem is composed at
 * 24 * dpr device pixels and CSS-sized back down to 24, so a 2x screen gets a
 * 48px raster instead of a 24px one blown up. `(resolution: Ndppx)` fires when
 * the page is zoomed or dragged onto another monitor.
 */
function useDevicePixelRatio(): number {
    const [dpr, setDpr] = useState(() =>
        typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        const onChange = () => setDpr(window.devicePixelRatio || 1);
        // Safari < 14 only has the deprecated listener API.
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else mq.addListener(onChange);
        return () => {
            if (mq.removeEventListener) mq.removeEventListener('change', onChange);
            else mq.removeListener(onChange);
        };
    }, [dpr]);

    return dpr;
}

/** Largest raster we will compose, per edge. 128px at 4x, and a hard stop. */
const MAX_RASTER_PX = 512;

export interface UseEmblemImageOptions {
    /** Force a texture version. Defaults to the app's selected one. */
    version?: string | null;
    /**
     * Override the device pixel ratio. Emblems.tsx pins this to 1 so its
     * exported PNG is a deterministic 128x128 whatever screen it was made on.
     */
    pixelRatio?: number;
}

export interface EmblemImage {
    /** PNG data URL, or null while colours/sheets are still loading. */
    src: string | null;
    /** The resolved cells + hexes, or null while the config is loading. */
    composition: EmblemComposition | null;
    /** Edge of the raster in device pixels. */
    rasterPx: number;
}

/**
 * Compose one emblem and hand back a data URL. The single path from "four
 * numbers" to "pixels" — used by <Emblem> for display and by Emblems.tsx for
 * both its preview and its Export PNG.
 */
export function useEmblemImage(
    selection: EmblemSelection,
    cssSize: number,
    options: UseEmblemImageOptions = {},
): EmblemImage {
    const colors = useEmblemColors();
    const sheets = useEmblemSheets(useEmblemArtVersion(options.version));
    const autoDpr = useDevicePixelRatio();

    const dpr = options.pixelRatio ?? autoDpr;
    const size = Number.isFinite(cssSize) && cssSize > 0 ? cssSize : 32;
    const rasterPx = Math.min(MAX_RASTER_PX, Math.max(1, Math.round(size * (dpr > 0 ? dpr : 1))));

    const composition = useMemo(
        () => emblemComposition(selection, colors),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selection.shape, selection.icon, selection.shapeColorId, selection.iconColorId, colors],
    );

    const src = useMemo(
        () => (sheets && composition ? emblemDataUrl(sheets, composition, rasterPx) : null),
        [sheets, composition, rasterPx],
    );

    return { src, composition, rasterPx };
}

/* -------------------------------------------------------------------------- */
/* <Emblem>                                                                   */
/* -------------------------------------------------------------------------- */

export interface EmblemProps extends EmblemSelection {
    /** Rendered edge in CSS px. 24 in a roster row, 32 default, 64+ for detail. */
    size?: number;
    version?: string | null;
    /** Accessible name. Defaults to a description built from the game's data. */
    label?: string;
    title?: string;
    className?: string;
    /** Cosmetic name of the shape, for the default accessible label. */
    shapeName?: string;
    /** Cosmetic name of the symbol, for the default accessible label. */
    iconName?: string;
}

/**
 * Describe an emblem for a screen reader, from the config plus the cosmetic
 * shape/symbol names. Colours are named by hue and always paired with their
 * hex, because the game gives them no names (see emblemColorLabel).
 */
export function describeEmblem(
    composition: EmblemComposition | null,
    shapeName?: string,
    iconName?: string,
): string {
    if (!composition) return 'clan emblem';
    const shape = shapeName ?? `shape ${composition.shape}`;
    const icon = iconName ?? `symbol ${composition.icon}`;
    const shapeColor = emblemColorLabel(composition.shapeHex);
    const article = /^[aeiou]/i.test(shapeColor) ? 'an' : 'a';
    return `${emblemColorLabel(composition.iconHex)} ${icon} on ${article} ${shapeColor} ${shape}`;
}

/**
 * A guild emblem: tinted shape, tinted symbol, tinted holder banner on top —
 * the same three layers, in the same geometry, as the in-game emblem and as the
 * Emblems designer page.
 *
 * The wrapper <span> carries the accessible name and a fixed box, so the layout
 * never moves between "still loading the sheets" and "drawn".
 */
export const Emblem: React.FC<EmblemProps> = ({
    shape,
    icon,
    shapeColorId,
    iconColorId,
    size = 32,
    version,
    label,
    title,
    className,
    shapeName,
    iconName,
}) => {
    const px = Number.isFinite(size) && size > 0 ? Math.round(size) : 32;
    const { src, composition } = useEmblemImage(
        { shape, icon, shapeColorId, iconColorId }, px, { version },
    );

    return (
        <span
            role="img"
            aria-label={label ?? describeEmblem(composition, shapeName, iconName)}
            title={title}
            className={cn('relative inline-block shrink-0 align-middle', className)}
            style={{ width: `${px}px`, height: `${px}px` }}
        >
            {src && (
                <img
                    src={src}
                    alt=""
                    width={px}
                    height={px}
                    draggable={false}
                    style={{ display: 'block', width: `${px}px`, height: `${px}px` }}
                />
            )}
        </span>
    );
};

export default Emblem;
