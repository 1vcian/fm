import { useEffect, useRef, useState } from 'react';
import { loadBattleVisuals } from '../Battle/gameView/visualData';
import { useGameDataContext } from '../../context/GameDataContext';
import { resolveTextureVersion } from '../../utils/ascensionUtils';
import { ageBackgroundRenderer, type ItemBackgroundDef } from './ageBackgroundGL';

/**
 * An age's item-card background as the game draws it (forge upgrade popup, item cards): the
 * AgeVisualConfig colour, and for the ages whose ItemBackground layer is active the animated
 * shader on top (see ageBackgroundGL.ts). Fills its positioned parent; animates only on screen.
 */

interface AgeLook { color: number[]; bg: ItemBackgroundDef | null }

let looks: Promise<AgeLook[]> | null = null;
function ageLooks(): Promise<AgeLook[]> {
    looks ??= loadBattleVisuals()
        .then(d => d.ages.map(a => ({ color: a.color, bg: ((a as unknown as { itemBackground?: ItemBackgroundDef | null }).itemBackground) ?? null })))
        .catch(() => []);
    return looks;
}

const rgb = (c: number[]) => `rgb(${c.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;

export function AgeBackground({ ageIdx, className }: { ageIdx: number; className?: string }) {
    const box = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const [look, setLook] = useState<AgeLook | null>(null);
    const { selectedVersion } = useGameDataContext();
    const textureBase = `${import.meta.env.BASE_URL}Texture2D/${resolveTextureVersion(selectedVersion ?? undefined) ?? selectedVersion ?? ''}/`;

    useEffect(() => {
        let alive = true;
        ageLooks().then(l => { if (alive) setLook(l[ageIdx] ?? null); });
        return () => { alive = false; };
    }, [ageIdx]);

    useEffect(() => {
        const def = look?.bg;
        const renderer = ageBackgroundRenderer();
        const el = box.current, cv = canvas.current;
        if (!def || !renderer || !el || !cv) return;
        let visible = true, raf = 0;
        const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
        io.observe(el);
        const start = performance.now();
        const loop = (now: number) => {
            raf = requestAnimationFrame(loop);
            if (!visible) return;
            const dpr = window.devicePixelRatio || 1;
            const cssW = el.clientWidth, cssH = el.clientHeight;
            if (!cssW || !cssH) return;
            const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
            if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
            const ctx = cv.getContext('2d');
            if (ctx) renderer.draw(ctx, w, h, cssW, cssH, def, look!.color, (now - start) / 1000, textureBase);
        };
        raf = requestAnimationFrame(loop);
        return () => { cancelAnimationFrame(raf); io.disconnect(); };
    }, [look, textureBase]);

    return (
        <div ref={box} className={className ?? 'absolute inset-0'} style={{ background: look ? rgb(look.color) : undefined }}>
            {look?.bg && <canvas ref={canvas} className="w-full h-full block" />}
        </div>
    );
}
