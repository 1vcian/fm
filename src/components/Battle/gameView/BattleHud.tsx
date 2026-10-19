/**
 * The in-battle HUD drawn over the canvas like the game's: the stage label with the wave dots at
 * the top, the round skill buttons with their cooldown sweep at the bottom right, and in PvP the
 * names and the match timer bar.
 */
import React, { useEffect, useState } from 'react';
import { SkillIcon, type SkillIconSource } from '../SkillLayer';
import { BATTLE_VISUALS_VERSION, loadBattleVisuals, type BattleVisualData } from './visualData';

interface HudSkill { id: string; state: 'ready' | 'active' | 'cooldown'; secondsLeft: number; phaseSeconds: number }

export interface BattleHudProps {
    title: string | null;
    waveIndex: number;
    waveCount: number;
    skills: HudSkill[];
    icons: SkillIconSource | null;
    pvp: { p1: string; p2: string; total: number; elapsed: number } | null;
    /** Skill ascension of the player's side: picks the icon of that level (SkillVisualConfig). */
    ascension?: number;
    /** SkillLibrary Rarity per skill type: the button's RarityBackground colour (GetRarity, Common if missing). */
    rarities?: Record<string, string>;
}

/**
 * The game's skill button (CombatSkillVisual prefab, 115 x 115 reference px): the icon fills the
 * Circle_Mask, which is the button inset by 3 px on each side. The icon is the Sprite asset's own
 * rect on its sheet, not a grid cell.
 */
const BUTTON = 115, MASK_INSET = 3;
/** The "Skills" HorizontalLayoutGroup of the battle UIs: lower right, padding right 60, spacing 20. */
const REF_W = 1080, PAD_RIGHT = 60, SPACING = 20;

export function GameSkillIcon({ data, id, ascension = 0, fallback }: { data: BattleVisualData | null; id: string; ascension?: number; fallback: React.ReactNode }) {
    const sid = data?.skillIds[id];
    const icons = sid !== undefined ? data?.skills[String(sid)]?.icons : undefined;
    const key = icons?.[Math.max(0, Math.min(icons.length - 1, ascension))] ?? icons?.[0];
    const def = key ? data?.sprites[key] : undefined;
    const tex = def ? data?.textures[def.tex] : undefined;
    if (!def || !tex) return <>{fallback}</>;
    const px = tex.w > def.w ? (def.x / (tex.w - def.w)) * 100 : 0;
    const py = tex.h > def.h ? (def.y / (tex.h - def.h)) * 100 : 0;
    return (
        <div className="absolute rounded-full overflow-hidden" style={{ inset: `${(MASK_INSET / BUTTON) * 100}%` }}>
            <div className="w-full h-full" role="img" aria-label={id} style={{
                backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/${BATTLE_VISUALS_VERSION}/${encodeURIComponent(def.tex)}.png)`,
                backgroundSize: `${(tex.w / def.w) * 100}% ${(tex.h / def.h) * 100}%`,
                backgroundPosition: `${px}% ${py}%`,
                backgroundRepeat: 'no-repeat',
            }} />
        </div>
    );
}

const outline = '0 2px 0 #1b1b1b, 2px 0 0 #1b1b1b, -2px 0 0 #1b1b1b, 0 -2px 0 #1b1b1b, 2px 2px 0 #1b1b1b, -2px 2px 0 #1b1b1b, 2px -2px 0 #1b1b1b, -2px -2px 0 #1b1b1b';
const gameFont: React.CSSProperties = { fontFamily: '"Baloo 2", "Baloo", "Arial Rounded MT Bold", system-ui, sans-serif', fontWeight: 800 };

export const BattleHud: React.FC<BattleHudProps> = ({ title, waveIndex, waveCount, skills, icons, pvp, ascension, rarities }) => {
    const [data, setData] = useState<BattleVisualData | null>(null);
    useEffect(() => { loadBattleVisuals().then(setData).catch(() => {}); }, []);
    return (
    <div className="absolute inset-0 pointer-events-none select-none">
        {title && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
                <div className="text-white text-base sm:text-xl leading-none whitespace-nowrap" style={{ ...gameFont, textShadow: outline }}>{title}</div>
                {waveCount > 1 && (
                    <div className="flex items-center">
                        {Array.from({ length: waveCount }, (_, i) => (
                            <React.Fragment key={i}>
                                {i > 0 && <div className="h-1 w-6 sm:w-10 bg-white border-y border-[#1b1b1b]" />}
                                <div className={`w-3 h-3 sm:w-4 sm:h-4 rounded-full border-2 border-[#1b1b1b] ${i <= waveIndex ? 'bg-sky-300' : 'bg-white'}`} />
                            </React.Fragment>
                        ))}
                    </div>
                )}
            </div>
        )}
        {skills.length > 0 && (
            <div className={`absolute left-0 right-0 flex justify-end ${pvp ? 'bottom-10 sm:bottom-12' : 'bottom-2'}`}
                style={{ paddingRight: `${(PAD_RIGHT / REF_W) * 100}%`, columnGap: `${(SPACING / REF_W) * 100}%` }}>
                {skills.map((k, i) => {
                    const frac = k.state === 'cooldown' && k.phaseSeconds > 0 ? Math.max(0, Math.min(1, k.secondsLeft / k.phaseSeconds)) : 0;
                    const inset = `${(MASK_INSET / BUTTON) * 100}%`;
                    const rgba = data?.constants.rarityColors?.[rarities?.[k.id] ?? 'Common'];
                    return (
                        <div key={`${k.id}-${i}`} className="relative rounded-full border-2 border-[#1b1b1b] shrink-0"
                            style={{ width: `${(BUTTON / REF_W) * 100}%`, aspectRatio: '1 / 1', backgroundColor: rgba ? `rgba(${rgba.slice(0, 3).map(v => Math.round(v * 255)).join(',')},${rgba[3]})` : undefined }} title={k.id}>
                            <GameSkillIcon data={data} id={k.id} ascension={ascension}
                                fallback={<div className="absolute rounded-full overflow-hidden flex items-center justify-center" style={{ inset }}><SkillIcon id={k.id} icons={icons} size={40} className="w-full h-full" /></div>} />
                            {frac > 0 && (
                                <div className="absolute rounded-full" style={{ inset, background: `conic-gradient(rgba(0,0,0,0.55) ${frac * 360}deg, transparent 0)` }} />
                            )}
                            {k.state === 'active' && <div className="absolute inset-0 rounded-full ring-2 ring-inset ring-yellow-300" />}
                        </div>
                    );
                })}
            </div>
        )}
        {pvp && (
            <div className="absolute left-0 right-0 bottom-0 px-2 pb-1.5 pt-1 bg-white/95 flex items-center gap-2 text-[11px] sm:text-sm" style={gameFont}>
                <span className="text-[#1b1b1b] truncate max-w-[25%]">{pvp.p1}</span>
                <div className="relative flex-1 h-3.5 sm:h-4 rounded-full border-2 border-[#1b1b1b] bg-[#3a3f4b] overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-[#00a2ff]" style={{ width: `${Math.max(0, Math.min(100, (1 - pvp.elapsed / Math.max(1, pvp.total)) * 100))}%` }} />
                    <span className="absolute inset-0 flex items-center justify-center text-white text-[9px] sm:text-[11px] leading-none" style={{ textShadow: '0 1px 0 #1b1b1b' }}>
                        {Math.max(0, Math.ceil(pvp.total - pvp.elapsed))}s
                    </span>
                </div>
                <span className="text-[#1b1b1b] truncate max-w-[25%] text-right">{pvp.p2}</span>
            </div>
        )}
    </div>
);
};
