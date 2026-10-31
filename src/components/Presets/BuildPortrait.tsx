import { useEffect, useRef, useState } from 'react';
import { skinMaxLevel } from '../../utils/skinArchive';
import { loadBattleVisuals, TextureCache } from '../Battle/gameView/visualData';
import { PortraitScene, isRangedWeapon, type PortraitBackground } from './portraitScene';
import { useGameData } from '../../hooks/useGameData';
import type { UserProfile } from '../../types/Profile';

/**
 * A build drawn the way the battle view draws it (PortraitScene: character, skins or the items
 * under hidden skins, mount, pets, fairy, set aura, optional battlefield), playing live. The loop
 * only runs while the canvas is on screen.
 *
 * Playback control (the Images Maker): `playing` false freezes the animation; `frame` then shows
 * that frame of a FRAME_RATE timeline. Going forward steps the scene on; going back replays it
 * from the start, so particles come out new (they are random in the game too).
 */

/** Frames per second of the frame-by-frame timeline (and of GIF exports). */
export const FRAME_RATE = 30;

interface Props {
    profile: UserProfile;
    /** BaseSetId of the complete, maxed set the build wears (its idle aura), if any. */
    setId?: string | null;
    width: number;
    height: number;
    /** Pixels per world unit. */
    scale: number;
    /** Draw the pets and the fairy too (behind the character, at PetVisual.PetOffsets and hovering). */
    pets?: boolean;
    /** 'bottom': feet near the bottom edge (cards); 'center': the figure centred in the box. */
    anchor?: 'bottom' | 'center';
    background?: PortraitBackground | null;
    /** Overrides WeaponLibrary.IsRanged of the equipped weapon (which skin variant is drawn). */
    weaponRanged?: boolean;
    /** false: frozen on `frame`. */
    playing?: boolean;
    frame?: number;
    /** Reports the frame on screen while playing (FRAME_RATE timeline). */
    onFrame?: (frame: number) => void;
    /** Receives the canvas, e.g. to export the current frame. */
    canvasHandle?: (c: HTMLCanvasElement | null) => void;
    className?: string;
}

export function BuildPortrait({
    profile, setId, width, height, scale, pets = false, anchor = 'bottom', background = null,
    weaponRanged: rangedOverride, playing = true, frame = 0, onFrame, canvasHandle, className,
}: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const weaponRanged = rangedOverride ?? isRangedWeapon(profile, weaponLibrary);
    const control = useRef({ playing, frame, onFrame });
    control.current = { playing, frame, onFrame };

    useEffect(() => {
        let raf = 0;
        let alive = true;
        let visible = true;
        const canvas = canvasRef.current;
        const io = canvas && typeof IntersectionObserver !== 'undefined'
            ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; })
            : null;
        if (canvas && io) io.observe(canvas);

        loadBattleVisuals().then((data) => {
            if (!alive) return;
            const tex = new TextureCache();
            const make = () => new PortraitScene(data, tex, { profile, setId, pets, background, weaponRanged });
            let scene = make();
            let shownFrame = 0;
            let last = performance.now();
            const loop = (now: number) => {
                if (!alive) return;
                const dt = Math.min(0.05, (now - last) / 1000);
                last = now;
                const ctx = canvasRef.current?.getContext('2d');
                if (!visible || !ctx) { raf = requestAnimationFrame(loop); return; }
                const c = control.current;
                if (c.playing) {
                    scene.step(dt);
                    const f = Math.floor(scene.t * FRAME_RATE);
                    if (f !== shownFrame) { shownFrame = f; c.onFrame?.(f); }
                } else if (c.frame !== shownFrame) {
                    if (c.frame < shownFrame) { scene = make(); shownFrame = 0; }
                    for (; shownFrame < c.frame; shownFrame++) scene.step(1 / FRAME_RATE);
                }
                scene.draw(ctx, width, height, scale, anchor, window.devicePixelRatio || 1);
                raf = requestAnimationFrame(loop);
            };
            raf = requestAnimationFrame(loop);
        }).catch(() => { /* no visuals for this version: the canvas stays empty */ });
        return () => { alive = false; cancelAnimationFrame(raf); io?.disconnect(); };
    }, [profile, setId, width, height, scale, pets, anchor, background, weaponRanged]);

    useEffect(() => {
        const c = canvasRef.current;
        if (!c) return;
        const dpr = window.devicePixelRatio || 1;
        c.width = width * dpr;
        c.height = height * dpr;
    }, [width, height]);

    useEffect(() => { canvasHandle?.(canvasRef.current); return () => canvasHandle?.(null); }, [canvasHandle]);

    return <canvas ref={canvasRef} style={{ width, height, maxWidth: '100%' }} className={className} />;
}

/**
 * BaseSetId of the set whose aura the game shows for these items: UnitSetEffectsView takes the
 * sets from GetAllFullMaxedSets, a complete set (every piece type of the set worn) whose every
 * worn piece IsMaxLevel. null otherwise.
 */
export function fullMaxedSet(items: UserProfile['items'], skinsLibrary: any, skinUpgradeLibrary: any): string | null {
    const worn = [items.Weapon?.skin && { type: 'Weapon', s: items.Weapon.skin }, items.Helmet?.skin && { type: 'Helmet', s: items.Helmet.skin }, items.Body?.skin && { type: 'Armour', s: items.Body.skin }]
        .filter(Boolean) as { type: string; s: NonNullable<NonNullable<UserProfile['items']['Weapon']>['skin']> }[];
    if (!worn.length || !skinsLibrary) return null;
    const rowOf = (type: string, idx: number) => Object.values<any>(skinsLibrary).find(r => r.SkinId.Type === type && r.SkinId.Idx === idx);
    const sets = new Set(worn.map(w => rowOf(w.type, w.s.idx)?.BaseSetId).filter(Boolean));
    if (sets.size !== 1) return null;
    const setId = [...sets][0] as string;
    const types = new Set(Object.values<any>(skinsLibrary).filter(r => r.BaseSetId === setId).map(r => r.SkinId.Type));
    if (worn.length !== types.size) return null;
    const maxed = worn.every(w => (w.s.level ?? 0) >= skinMaxLevel(skinUpgradeLibrary, w.type, w.s.idx));
    return maxed ? setId : null;
}

/** World units a character with mount and weapon spans across, to fit a narrow box. */
const UNITS_WIDE = 3.2;

/** BuildPortrait that fills its parent: width and height follow the box, the scale whichever is tighter. */
export function FitBuildPortrait({ profile, setId, unitsTall = 3.4, className }: { profile: UserProfile; setId?: string | null; unitsTall?: number; className?: string }) {
    const boxRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);
    useEffect(() => {
        const el = boxRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([e]) => {
            const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height);
            setSize(prev => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return (
        <div ref={boxRef} className={className ?? 'w-full h-full'}>
            {size && size.w > 0 && size.h > 0 && (
                <BuildPortrait profile={profile} setId={setId} width={size.w} height={size.h} scale={Math.min(size.h / unitsTall, size.w / UNITS_WIDE)} anchor="center" />
            )}
        </div>
    );
}
