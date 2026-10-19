/**
 * Canvas battlefield drawn from the game's own assets (see scene.ts). The modal feeds one engine
 * snapshot per 0.1 s game tick (the game's logic rate); this component draws at RENDER_FPS and
 * interpolates between the ticks, so playback stays smooth without redrawing every display frame.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { SceneVisuals } from '../../../engine/visualSnapshot';
import { loadBattleVisuals, TextureCache, type BattleVisualData } from './visualData';
import { BattleSceneRenderer, type Look, type SceneMode } from './scene';

/** Drawing rate. The battle logic itself runs at the game's 10 ticks per second. */
const RENDER_FPS = 30;

export interface BattleCanvasProps {
    visuals: SceneVisuals | null;
    playing: boolean;
    speed: number;
    mode: SceneMode;
    /** Builds the looks once the visual data is loaded. */
    looks: (data: BattleVisualData) => { ally: Look; enemy?: Look };
    enemyLibrary?: Record<string, any>;
    skillAscension: { ally: number; enemy: number };
    seed: number;
    /** Changes when the battle restarts: the scene state (camera, pets, labels) starts over. */
    battleKey: string | number;
    /** Called when the game data cannot be loaded, so the caller can show its fallback. */
    onUnavailable?: () => void;
    children?: React.ReactNode;
}

export const BattleCanvas: React.FC<BattleCanvasProps> = (props) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const [data, setData] = useState<BattleVisualData | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const texRef = useRef<TextureCache | null>(null);
    const rendererRef = useRef<BattleSceneRenderer | null>(null);

    useEffect(() => {
        let cancelled = false;
        loadBattleVisuals()
            .then(d => { if (!cancelled) setData(d); })
            .catch((e) => { console.warn('Battle visuals unavailable, using the schematic view:', e); if (!cancelled) latest.current.onUnavailable?.(); });
        return () => { cancelled = true; };
    }, []);

    // A new scene per battle (and per mode / look change).
    useEffect(() => {
        if (!data) return;
        if (!texRef.current) texRef.current = new TextureCache();
        const looks = latest.current.looks(data);
        rendererRef.current = new BattleSceneRenderer({
            data,
            tex: texRef.current,
            mode: latest.current.mode,
            allyLook: looks.ally,
            enemyLook: looks.enemy,
            enemyLibrary: latest.current.enemyLibrary,
            skillAscension: latest.current.skillAscension,
            seed: latest.current.seed,
        });
    }, [data, props.battleKey]);

    useEffect(() => {
        if (!data) return;
        let raf = 0;
        let alive = true;
        let lastDraw = -Infinity;
        const frame = (now: number) => {
            if (!alive) return;
            // Draw at RENDER_FPS: skip display frames that come sooner (half a frame of slack keeps
            // a 60 Hz screen on every second frame instead of drifting).
            if (now - lastDraw < 1000 / RENDER_FPS - 1000 / 120) { raf = requestAnimationFrame(frame); return; }
            lastDraw = now;
            const c = canvasRef.current;
            const wrap = wrapRef.current;
            const r = rendererRef.current;
            const v = latest.current.visuals;
            if (c && wrap && r && v) {
                const dpr = Math.min(2, window.devicePixelRatio || 1);
                const w = wrap.clientWidth, h = wrap.clientHeight;
                const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
                if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
                const ctx = c.getContext('2d');
                if (ctx) {
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    r.render(ctx, pw, ph, v, now, latest.current.speed, latest.current.playing);
                }
            }
            raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => { alive = false; cancelAnimationFrame(raf); };
    }, [data]);

    return (
        <div ref={wrapRef} className="absolute inset-0 overflow-hidden" data-testid="battle-canvas">
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
            {props.children}
        </div>
    );
};
