import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, Skull, RotateCcw } from 'lucide-react';
import { loadBattleVisuals, TextureCache, type BattleVisualData, type ParticleDef } from '../Battle/gameView/visualData';
import { RigInstance, rigItems, sortItems, layerIndex, IDENTITY, type DrawItem, type Mat } from '../Battle/gameView/rig';
import { Emitter, tintTexture } from '../Battle/gameView/particles';
import { buildUnit, lookFromSkins } from '../Battle/gameView/scene';

/**
 * The effect a set shows in the game when it is complete with every piece at max level.
 *
 * UnitSetEffectsView (on the UnitView root) gets those sets from UnitExtensions
 * .GetAllFullMaxedSets: complete sets whose every piece passes SkinExtentions.IsMaxLevel. For each
 * one it instantiates SetVisualConfig.IdleEffect as a child of the unit (AddIdleEffects 0x404568C)
 * and, when the unit dies, DeathEffect at its position (PlayDeathEffects 0x40459CC). The prefabs
 * come from the APK through reverseForge/extract_battle_visuals.py (BattleVisuals.json setEffects).
 */

export interface SetPieces {
    helmet?: number;
    armour?: number;
    weapon?: number;
}

const W = 380;
const H = 400;
/** Pixels per world unit: the character is about 1.3 units tall. */
const S = 82;
const ROOT: Mat = [1, 0, 0, 1, 0, 0];

function emittersOf(rig: RigInstance, data: BattleVisualData, once: boolean): Emitter[] {
    const out: Emitter[] = [];
    rig.nodes.forEach((nd, i) => {
        if (!nd.ps || !rig.isVisible(i)) return;
        const ps = nd.ps as ParticleDef;
        out.push(new Emitter(ps, rig.world[i] ?? IDENTITY, ps.renderer?.order ?? 0, layerIndex(data, ps.renderer?.layer), once));
    });
    return out;
}

function PreviewCanvas({ setId, pieces, deathToken }: { setId: string; pieces: SetPieces; deathToken: number }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const deathRef = useRef(deathToken);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let raf = 0;
        let alive = true;
        loadBattleVisuals().then((data) => {
            if (!alive) return;
            const fx = data.setEffects?.[setId];
            if (!fx) { setError('No effect for this set in the game files.'); return; }
            const tex = new TextureCache();
            const unit = buildUnit(data, lookFromSkins(data, pieces), 'unit');
            const walk = unit.controller?.Walk ? data.clips[unit.controller.Walk] : undefined;
            const idleRig = fx.idle && data.prefabs[fx.idle] ? new RigInstance(data, fx.idle) : null;
            let idle: Emitter[] = [];
            let death: Emitter[] = [];
            let dead = false;
            let respawnAt = 0;
            let t = 0;
            let seenDeath = deathRef.current;
            const spawnIdle = () => {
                if (!idleRig) return;
                idleRig.update(ROOT);
                idle = emittersOf(idleRig, data, false);
            };
            spawnIdle();
            let last = performance.now();
            const frame = (now: number) => {
                if (!alive) return;
                const dt = Math.min(0.05, (now - last) / 1000);
                last = now;
                t += dt;
                if (deathRef.current !== seenDeath) {
                    seenDeath = deathRef.current;
                    if (fx.death && data.prefabs[fx.death]) {
                        const rig = new RigInstance(data, fx.death);
                        rig.update(ROOT);
                        death = emittersOf(rig, data, true);
                    }
                    dead = true;
                    idle = [];
                    respawnAt = t + 2.5;
                }
                if (dead && t >= respawnAt && death.every((e) => e.done)) {
                    dead = false;
                    death = [];
                    spawnIdle();
                }
                const ctx = canvasRef.current?.getContext('2d');
                if (!ctx) { raf = requestAnimationFrame(frame); return; }
                const dpr = window.devicePixelRatio || 1;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.clearRect(0, 0, W, H);
                ctx.setTransform(S * dpr, 0, 0, -S * dpr, (W / 2) * dpr, H * 0.78 * dpr);

                const items: DrawItem[] = [];
                if (!dead) {
                    unit.rig.clearAnimation();
                    unit.rig.applyClip(walk, t, true);
                    unit.rig.update(ROOT);
                    // The HP bar is drawn apart by the battle view; a full-health unit shows none.
                    items.push(...rigItems(unit.rig, tex, undefined, (i) => i === unit.hpBar));
                    if (idleRig) items.push(...rigItems(idleRig, tex));
                }
                for (const em of [...idle, ...death]) {
                    em.update(dt);
                    const img = em.texture ? tex.get(em.texture) : null;
                    items.push({ layer: em.layer, order: em.order, y: em.origin[5], seq: 0, draw: (c) => em.draw(c, img, tintTexture) });
                }
                death = death.filter((e) => !e.done);
                sortItems(items);
                for (const it of items) it.draw(ctx);
                raf = requestAnimationFrame(frame);
            };
            raf = requestAnimationFrame(frame);
        }).catch(() => setError('The game visuals could not be loaded.'));
        return () => { alive = false; cancelAnimationFrame(raf); };
    }, [setId, pieces.helmet, pieces.armour, pieces.weapon]);

    useEffect(() => { deathRef.current = deathToken; }, [deathToken]);

    useEffect(() => {
        const c = canvasRef.current;
        if (!c) return;
        const dpr = window.devicePixelRatio || 1;
        c.width = W * dpr;
        c.height = H * dpr;
    }, []);

    if (error) return <div className="text-xs text-text-muted p-6 text-center">{error}</div>;
    return <canvas ref={canvasRef} style={{ width: W, height: H, maxWidth: '100%' }} className="mx-auto block" data-testid="set-effect-canvas" />;
}

/** A button that opens the set's in-game effect, animated. */
export function SetEffectButton({ setId, setName, pieces }: { setId: string; setName: string; pieces: SetPieces }) {
    const [open, setOpen] = useState(false);
    const [deathToken, setDeathToken] = useState(0);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                data-testid="set-effect-open"
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-accent-primary/40 bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20"
                title="The effect this set shows in the game when all its pieces are at max level"
            >
                <Sparkles className="w-3.5 h-3.5" /> Max set effect
            </button>
            {open && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
                    <div
                        role="dialog"
                        aria-label={`${setName} effect`}
                        data-testid="set-effect-modal"
                        className="bg-bg-primary text-text-primary w-full max-w-md rounded-2xl border border-border shadow-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-gradient-to-r from-accent-primary/15 via-bg-secondary/40 to-bg-secondary/40">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-9 h-9 shrink-0 rounded-xl bg-accent-primary/20 border border-accent-primary/40 flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 text-accent-primary" />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-bold">{setName}</div>
                                    <div className="text-[10px] text-text-muted">Shown in battle when the set is complete and every piece is at max level</div>
                                </div>
                            </div>
                            <button onClick={() => setOpen(false)} aria-label="Close" className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-input">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="bg-[#1b2330] py-2">
                            <PreviewCanvas setId={setId} pieces={pieces} deathToken={deathToken} />
                        </div>
                        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border">
                            <span className="text-[11px] text-text-muted">Idle effect around the character, death effect where it falls.</span>
                            <button
                                onClick={() => setDeathToken((n) => n + 1)}
                                data-testid="set-effect-death"
                                className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 shrink-0"
                            >
                                <Skull className="w-3.5 h-3.5" /> Play death <RotateCcw className="w-3 h-3 opacity-60" />
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
