/**
 * Draws what the skills do on the battlefield, from the engine's own state (sceneVisuals):
 * every skill area at its real position and radius (the hit region), the moment each one pulses,
 * every projectile (weapon shots, Arrows, Shurikens, Drone shots), the Drones, the active buffs
 * around each fighter, and a floating number for every hit, heal, block, miss and reflect.
 *
 * Geometry: x in percent of the field (worldToScreen), y in pixels (yPx, world y up). An area's
 * ellipse is its true hit radius in both axes, so a unit drawn inside it is a unit it can hit.
 */
import React from 'react';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { HIT_VISIBLE_SECONDS, type SceneVisuals, type VisualBuff, type VisualEffect } from '../../engine/visualSnapshot';
import { formatNumber } from '../../utils/format';

export const SKILL_COLORS: Record<string, string> = {
    Meteorite: '#f97316',
    CannonBarrage: '#cbd5e1',
    Lightning: '#facc15',
    Bomb: '#ef4444',
    Worm: '#b45309',
    Thorns: '#22c55e',
    Shout: '#38bdf8',
    Stampede: '#d97706',
    RainOfArrows: '#eab308',
    StrafeRun: '#94a3b8',
    Arrows: '#fde68a',
    Shuriken: '#c4b5fd',
    Drone: '#22d3ee',
    Meat: '#4ade80',
    Morale: '#fbbf24',
    Berserk: '#f43f5e',
    Buff: '#60a5fa',
    HigherMorale: '#fb923c',
};
const colorOf = (id?: string) => (id && SKILL_COLORS[id]) || '#e5e7eb';
const SIDE = { ally: '#3b82f6', enemy: '#ef4444' };

/** Skills whose damage lands once, at the end (a falling or delayed strike). */
const DELAYED = new Set(['Meteorite', 'CannonBarrage', 'Lightning', 'Bomb', 'Worm']);
const FALLING = new Set(['Meteorite', 'CannonBarrage']);

export interface SkillIconSource {
    textureSrc: string;
    sheet: { sprite_size: { width: number; height: number }; texture_size: { width: number; height: number } };
    indexOf: (skillId: string) => number;
}

export function SkillIcon({ id, icons, size = 20, className = '' }: { id: string; icons: SkillIconSource | null; size?: number; className?: string }) {
    const idx = icons ? icons.indexOf(id) : -1;
    if (!icons || idx < 0) {
        return (
            <div style={{ width: size, height: size, background: colorOf(id) }}
                className={`rounded-full flex items-center justify-center text-[8px] font-black text-black ${className}`}>
                {id.slice(0, 2)}
            </div>
        );
    }
    return (
        <div style={{ width: size, height: size }} className={`overflow-hidden ${className}`}>
            <SpriteSheetIcon
                textureSrc={icons.textureSrc}
                spriteWidth={icons.sheet.sprite_size.width}
                spriteHeight={icons.sheet.sprite_size.height}
                sheetWidth={icons.sheet.texture_size.width}
                sheetHeight={icons.sheet.texture_size.height}
                iconIndex={idx}
                className="w-full h-full"
                smooth
            />
        </div>
    );
}

interface LayerProps {
    visuals: SceneVisuals;
    worldToScreen: (x: number) => number;
    /** Field units -> percent of the field width (for radii). */
    unitsToPct: (u: number) => number;
    yPx: (y: number) => number;
    icons: SkillIconSource | null;
}

const at = (left: number, top: number, extra = ''): React.CSSProperties => ({
    left: `${left}%`,
    top: `calc(50% + ${top}px)`,
    transform: `translate(-50%, -50%) ${extra}`,
});

function Area({ e, props }: { e: VisualEffect; props: LayerProps }) {
    const { worldToScreen, unitsToPct, yPx, icons } = props;
    const color = colorOf(e.skillId);
    const side = e.isAllied ? SIDE.ally : SIDE.enemy;
    const w = unitsToPct(e.radius * 2);
    const h = Math.abs(yPx(e.radius * 2));
    const progress = e.duration > 0 ? Math.max(0, Math.min(1, e.timer / e.duration)) : 1;
    const flashing = e.sincePulse != null && e.sincePulse < 0.2;
    const waiting = e.timer < 0;
    const delayed = DELAYED.has(e.skillId) && !e.hasPulse;
    return (
        <div className="absolute pointer-events-none" style={{ ...at(worldToScreen(e.x), yPx(e.y)), width: `${w}%`, height: h, zIndex: 15 }}>
            {/* hit region */}
            <div className="absolute inset-0 rounded-[50%] transition-[background-color] duration-100"
                style={{
                    border: `2px ${delayed || waiting ? 'dashed' : 'solid'} ${color}`,
                    boxShadow: `0 0 0 1px ${side}55 inset`,
                    background: delayed ? `${color}14` : `${color}${flashing ? '55' : '22'}`,
                }} />
            {/* delayed strike: the fill grows until the moment it lands */}
            {delayed && (
                <div className="absolute rounded-[50%]"
                    style={{ left: '50%', top: '50%', width: `${progress * 100}%`, height: `${progress * 100}%`, transform: 'translate(-50%,-50%)', background: `${color}40` }} />
            )}
            {/* pulse ring */}
            {flashing && (
                <div className="absolute inset-0 rounded-[50%]"
                    style={{ border: `3px solid ${color}`, transform: `scale(${1 + (e.sincePulse ?? 0) * 1.2})`, opacity: 1 - (e.sincePulse ?? 0) * 4 }} />
            )}
            {/* rain of arrows / strafe: streaks */}
            {(e.skillId === 'RainOfArrows' || e.skillId === 'StrafeRun') && !waiting && (
                <div className="absolute inset-0 overflow-hidden rounded-[50%]">
                    {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="absolute w-px"
                            style={{ left: `${10 + i * 15}%`, top: `${((e.timer * 300 + i * 37) % 100) - 30}%`, height: '30%', background: color, opacity: 0.8 }} />
                    ))}
                </div>
            )}
            {/* falling meteor / cannonball */}
            {FALLING.has(e.skillId) && (
                <div className="absolute left-1/2" style={{ top: '50%', transform: `translate(-50%, ${-50 - (1 - progress) * 260}%)` }}>
                    <SkillIcon id={e.skillId} icons={icons} size={22} className="rounded-full drop-shadow-[0_0_6px_rgba(249,115,22,0.9)]" />
                </div>
            )}
            {/* lightning: the bolt at the strike */}
            {e.skillId === 'Lightning' && progress > 0.75 && (
                <div className="absolute left-1/2 bottom-1/2 w-1 -translate-x-1/2"
                    style={{ height: 160, background: `linear-gradient(to top, ${color}, transparent)`, boxShadow: `0 0 10px ${color}` }} />
            )}
            {/* centre icon for the rest */}
            {!FALLING.has(e.skillId) && e.skillId !== 'Lightning' && (
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-90">
                    <SkillIcon id={e.skillId} icons={icons} size={e.skillId === 'Bomb' ? 22 : 18}
                        className={`rounded ${e.skillId === 'Bomb' && progress > 0.6 ? 'animate-pulse' : ''}`} />
                </div>
            )}
        </div>
    );
}

export function SkillLayer(props: LayerProps) {
    const { visuals, worldToScreen, yPx, icons } = props;
    return (
        <>
            {visuals.effects.map(e => <Area key={`a${e.id}`} e={e} props={props} />)}

            {/* projectiles: weapon shots as tracers, skill shots with their own look */}
            {visuals.shots.map(s => {
                const angle = (Math.atan2(-s.vy, s.vx) * 180) / Math.PI;
                const side = s.isAllied ? SIDE.ally : SIDE.enemy;
                const style = { ...at(worldToScreen(s.x), yPx(s.y), `rotate(${angle}deg)`), zIndex: 45 };
                if (!s.skillId) {
                    return (
                        <div key={`p${s.id}`} className="absolute flex items-center pointer-events-none" style={style}>
                            <div className="w-5 h-1 rounded-full opacity-50" style={{ background: s.isAllied ? '#fde047' : '#f87171' }} />
                            <div className="w-3 h-3 rounded-full" style={{ background: s.isAllied ? '#facc15' : '#ef4444', boxShadow: `0 0 10px ${s.isAllied ? '#facc15' : '#ef4444'}` }} />
                        </div>
                    );
                }
                if (s.skillId === 'Arrows') {
                    return (
                        <div key={`p${s.id}`} className="absolute flex items-center pointer-events-none" style={style}>
                            <div className="h-0.5 w-6" style={{ background: colorOf('Arrows') }} />
                            <div className="w-0 h-0 border-y-[4px] border-y-transparent border-l-[7px]" style={{ borderLeftColor: side }} />
                        </div>
                    );
                }
                if (s.skillId === 'Shuriken') {
                    return (
                        <div key={`p${s.id}`} className="absolute pointer-events-none animate-spin" style={{ ...at(worldToScreen(s.x), yPx(s.y)), zIndex: 45 }}>
                            <div className="w-3.5 h-3.5 rotate-45" style={{ background: colorOf('Shuriken'), boxShadow: `0 0 6px ${side}` }} />
                        </div>
                    );
                }
                return (
                    <div key={`p${s.id}`} className="absolute flex items-center pointer-events-none" style={style}>
                        <div className="w-4 h-0.5 opacity-60" style={{ background: colorOf(s.skillId) }} />
                        <div className="w-2 h-2 rounded-full" style={{ background: colorOf(s.skillId), boxShadow: `0 0 8px ${colorOf(s.skillId)}` }} />
                    </div>
                );
            })}

            {/* summons (Drones) */}
            {visuals.summons.map(u => (
                <div key={`s${u.id}`} className="absolute pointer-events-none flex flex-col items-center" style={{ ...at(worldToScreen(u.x), yPx(u.y)), zIndex: 35 }}>
                    <div className={`rounded-full p-0.5 border-2 bg-black/60 ${u.attacking ? 'scale-110' : ''} transition-transform`}
                        style={{ borderColor: u.isAlly ? SIDE.ally : SIDE.enemy, boxShadow: `0 0 8px ${colorOf(u.skillId)}` }}>
                        <SkillIcon id={u.skillId} icons={icons} size={20} className="rounded-full" />
                    </div>
                    {u.secondsLeft != null && <span className="text-[8px] font-mono text-cyan-200 leading-none mt-0.5">{u.secondsLeft.toFixed(1)}s</span>}
                </div>
            ))}

            {/* hits */}
            {visuals.hits.map(h => {
                const t = h.age / HIT_VISIBLE_SECONDS;
                const rise = 64 + h.age * 50; // starts above the fighter's HP text
                // Spread simultaneous numbers sideways so a volley stays readable.
                const spread = ((h.key * 37) % 9) - 4;
                const color = h.kind === 'heal' ? '#4ade80' : h.kind === 'block' ? '#93c5fd' : h.kind === 'dodge' ? '#9ca3af'
                    : h.kind === 'reflect' ? '#c084fc' : h.kind === 'crit' ? '#fb923c' : h.source === 'skill' ? colorOf(h.skillId) : '#ffffff';
                const label = h.kind === 'dodge' ? 'MISS' : h.kind === 'block' ? 'BLOCK'
                    : `${h.kind === 'heal' ? '+' : h.kind === 'reflect' ? '↩ ' : ''}${formatNumber(h.amount)}${h.kind === 'crit' ? '!' : ''}`;
                return (
                    <React.Fragment key={`h${h.key}`}>
                        {/* impact mark where it landed */}
                        {h.age < 0.25 && h.kind !== 'heal' && h.kind !== 'dodge' && (
                            <div className="absolute pointer-events-none rounded-full"
                                style={{
                                    ...at(worldToScreen(h.x), yPx(h.y), `scale(${1 + h.age * 4})`),
                                    width: h.source === 'melee' ? 26 : 18, height: h.source === 'melee' ? 26 : 18,
                                    border: `2px solid ${color}`, opacity: 1 - h.age * 4, zIndex: 55,
                                    borderStyle: h.source === 'melee' ? 'dashed' : 'solid',
                                }} />
                        )}
                        <div className="absolute pointer-events-none flex items-center gap-0.5 whitespace-nowrap font-black"
                            style={{
                                ...at(worldToScreen(h.x) + spread * 1.6, yPx(h.y) - rise),
                                color, opacity: Math.max(0, 1 - t * t), zIndex: 60,
                                fontSize: h.kind === 'crit' ? 14 : h.source === 'skill' ? 11 : 10,
                                textShadow: '0 1px 2px #000, 0 0 3px #000',
                            }}>
                            {h.source === 'skill' && h.skillId && <SkillIcon id={h.skillId} icons={icons} size={11} className="rounded-sm" />}
                            {label}
                        </div>
                    </React.Fragment>
                );
            })}
        </>
    );
}

/** The active buffs of one fighter: an aura plus one icon per buff with its remaining time. */
export function BuffAura({ buffs, icons }: { buffs: VisualBuff[]; icons: SkillIconSource | null }) {
    if (!buffs.length) return null;
    const color = colorOf(buffs[0].skillId);
    const dmg = buffs.reduce((s, b) => s + b.damage, 0);
    const hp = buffs.reduce((s, b) => s + b.health, 0);
    return (
        <>
            <div className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1 w-16 h-16 rounded-full animate-pulse pointer-events-none"
                style={{ boxShadow: `0 0 18px 6px ${color}88`, border: `2px solid ${color}aa` }} />
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 pointer-events-none">
                <div className="flex gap-1">
                    {buffs.map((b, i) => (
                        <div key={`${b.skillId}-${i}`} className="relative">
                            <SkillIcon id={b.skillId} icons={icons} size={20} className="rounded border" />
                            <div className="absolute left-0 bottom-0 h-0.5" style={{ width: `${b.phaseSeconds > 0 ? (b.secondsLeft / b.phaseSeconds) * 100 : 0}%`, background: colorOf(b.skillId) }} />
                        </div>
                    ))}
                </div>
                <div className="text-[9px] font-bold leading-none whitespace-nowrap" style={{ textShadow: '0 1px 2px #000' }}>
                    {dmg > 0 && <span className="text-red-300">+{formatNumber(dmg)} DMG </span>}
                    {hp > 0 && <span className="text-green-300">+{formatNumber(hp)} HP</span>}
                </div>
            </div>
        </>
    );
}
