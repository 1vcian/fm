import type { ReactNode } from 'react';
import { Plus, Minus, Info } from 'lucide-react';
import { SpriteIcon } from '../UI/SpriteIcon';
import { EggIcon } from '../UI/EggIcon';
import { useProfile } from '../../context/ProfileContext';
import { cn } from '../../lib/utils';

// One editable resource tile. `icon` is a rendered node so callers can pass a
// SpriteIcon, an EggIcon, or anything else.
function ResourceCard({ icon, label, value, onChange, ring, hint }: {
    icon: ReactNode; label: string; value: number; onChange: (v: number) => void; ring?: string; hint?: string;
}) {
    return (
        <div className="group bg-bg-secondary/40 border border-border/50 rounded-xl p-3 hover:border-accent-primary/40 transition-colors">
            <div className="flex items-center gap-2 mb-2">
                <div className={cn('w-9 h-9 rounded-lg bg-bg-input flex items-center justify-center shrink-0 border border-border/60', ring)}>
                    {icon}
                </div>
                <div className="min-w-0">
                    <div className="text-xs font-bold truncate leading-tight">{label}</div>
                    {hint && <div className="text-[9px] text-text-muted truncate">{hint}</div>}
                </div>
            </div>
            <div className="flex items-center justify-between bg-bg-input rounded-lg border border-border">
                <button
                    type="button"
                    aria-label={`Decrease ${label}`}
                    className="px-2.5 py-1.5 text-text-muted hover:text-white active:scale-90 transition"
                    onClick={() => onChange(Math.max(0, value - 1))}
                >
                    <Minus className="w-3.5 h-3.5" />
                </button>
                <input
                    type="number"
                    className="bg-transparent text-center font-mono font-bold text-sm w-full min-w-0 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    value={value}
                    onChange={e => { const v = parseInt(e.target.value); onChange(!isNaN(v) && v >= 0 ? v : 0); }}
                    onFocus={e => e.target.select()}
                />
                <button
                    type="button"
                    aria-label={`Increase ${label}`}
                    className="px-2.5 py-1.5 text-text-muted hover:text-white active:scale-90 transition"
                    onClick={() => onChange(value + 1)}
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}

function SectionTitle({ children }: { children: ReactNode }) {
    return <h3 className="text-[11px] font-black uppercase tracking-widest text-accent-primary/90 border-b border-white/5 pb-2 mb-3">{children}</h3>;
}

const EGG_RARITIES: { key: string; ring: string }[] = [
    { key: 'Common', ring: 'ring-1 ring-inset ring-slate-400/30' },
    { key: 'Rare', ring: 'ring-1 ring-inset ring-blue-400/40' },
    { key: 'Epic', ring: 'ring-1 ring-inset ring-purple-400/40' },
    { key: 'Legendary', ring: 'ring-1 ring-inset ring-amber-400/40' },
    { key: 'Ultimate', ring: 'ring-1 ring-inset ring-red-400/40' },
    { key: 'Mythic', ring: 'ring-1 ring-inset ring-fuchsia-400/40' },
];
type KeyType = 'Hammer' | 'Skill' | 'Egg' | 'Potion';
const DUNGEON_KEYS: { key: KeyType; icon: string; label: string }[] = [
    { key: 'Hammer', icon: 'HammerKey', label: 'Hammer' },
    { key: 'Skill', icon: 'SkillKey', label: 'Skill' },
    { key: 'Egg', icon: 'PetKey', label: 'Egg' },
    { key: 'Potion', icon: 'PotionKey', label: 'Potion' },
];
const EMPTY_KEYS = { Hammer: 0, Skill: 0, Egg: 0, Potion: 0 };

// Full player-resource editor. Reads/writes the SAME profile.misc.* keys the individual
// calculators use (forge hammers, gem count, skill tickets, clock winders, eggshells, tech
// potions, owned eggs, dungeon keys), so editing here and editing inside a calculator stay in
// sync — no separate resource store, no per-calculator rewiring. Coins / Guild Potions have no
// consumer yet, so they live on their own misc keys for now.
export function ResourcesEditor() {
    const { profile, updateNestedProfile } = useProfile();
    const m = profile.misc;
    const setMisc = (patch: any) => updateNestedProfile('misc', patch);

    const hammers = parseInt(m.forgeCalculator?.hammers || '0', 10) || 0;
    const setHammers = (v: number) => setMisc({ forgeCalculator: { ...m.forgeCalculator, hammers: String(v) } });

    const ownedEggs: Record<string, number> = (m.ownedEggs as Record<string, number>) || {};
    const keys = (m.dungeonKeyCounts as Record<KeyType, number>) || EMPTY_KEYS;

    return (
        <div className="space-y-6">
            <div>
                <SectionTitle>Currencies</SectionTitle>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    <ResourceCard icon={<SpriteIcon name="Coin" size={22} />} label="Coins" value={m.coins || 0} onChange={v => setMisc({ coins: v })} />
                    <ResourceCard icon={<SpriteIcon name="GemSquare" size={22} />} label="Gems" hint="Tree / Egg calculators" value={m.gemCount || 0} onChange={v => setMisc({ gemCount: v })} />
                    <ResourceCard icon={<SpriteIcon name="Hammer" size={22} />} label="Hammers" hint="Forge calculator" value={hammers} onChange={setHammers} />
                    <ResourceCard icon={<SpriteIcon name="SkillTicket" size={22} />} label="Skill Tickets" hint="Skill calculator" value={m.skillCalculatorTickets || 0} onChange={v => setMisc({ skillCalculatorTickets: v })} />
                    <ResourceCard icon={<SpriteIcon name="MountKey" size={22} />} label="Clock Winders" hint="Mount calculator" value={m.mountCalculatorWinders || 0} onChange={v => setMisc({ mountCalculatorWinders: v })} />
                    <ResourceCard icon={<SpriteIcon name="Eggshell" size={22} />} label="Eggshells" hint="Egg summon calculator" value={m.eggshellCount || 0} onChange={v => setMisc({ eggshellCount: v })} />
                    <ResourceCard icon={<SpriteIcon name="Potion" size={22} />} label="Tech Potions" hint="Tech tree calculators" value={m.techPotions || 0} onChange={v => setMisc({ techPotions: v })} />
                    <ResourceCard icon={<SpriteIcon name="GuildPotions" size={22} />} label="Guild Potions" value={m.guildPotions || 0} onChange={v => setMisc({ guildPotions: v })} />
                </div>
            </div>

            <div>
                <SectionTitle>Eggs</SectionTitle>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {EGG_RARITIES.map(({ key, ring }) => (
                        <ResourceCard
                            key={key}
                            icon={<EggIcon rarity={key} size={26} />}
                            ring={ring}
                            label={key}
                            value={ownedEggs[key] || 0}
                            onChange={v => setMisc({ ownedEggs: { ...ownedEggs, [key]: v } })}
                        />
                    ))}
                </div>
            </div>

            <div>
                <SectionTitle>Dungeon Keys</SectionTitle>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {DUNGEON_KEYS.map(({ key, icon, label }) => (
                        <ResourceCard
                            key={key}
                            icon={<SpriteIcon name={icon} size={22} />}
                            label={`${label} Key`}
                            value={keys[key] || 0}
                            onChange={v => setMisc({ dungeonKeyCounts: { ...keys, [key]: v } })}
                        />
                    ))}
                </div>
            </div>

            <p className="text-[11px] text-text-muted flex items-start gap-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent-primary" />
                These are the same values the calculators use — edit them here or inside a calculator, they stay in sync.
                (Coins and Guild Potions aren&apos;t consumed by any calculator yet.)
            </p>
        </div>
    );
}
