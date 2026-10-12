import { useEffect, useMemo, useState } from 'react';
import { Upload, Save, AlertTriangle, CheckCircle2, Loader2, PencilLine, Plus, X, Cat, Star } from 'lucide-react';
import type { UserProfile } from '../../types/Profile';
import type { CardItem, CardRead, CardSkill, CardUnit } from '../../utils/ocr/cardTypes';
import { mergeCardReads, CARD_ITEM_SLOTS } from '../../utils/ocr/cardTypes';
import { profileFromCard } from '../../pvp/profileFromCard';
import { solveTrees, type SolveResult } from '../../pvp/treeSolver';
import { useStatLibraries } from '../../hooks/useGlobalStats';
import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { useGameDataContext } from '../../context/GameDataContext';
import { formatNumber } from '../../utils/format';
import { parseCompactNumber } from '../../utils/ocr/parse';
import { getItemImage } from '../../utils/itemAssets';
import { getAscensionTexturePath } from '../../utils/ascensionUtils';
import { AGES } from '../../utils/constants';
import { getRarityBgStyle } from '../../lib/utils';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { ItemSelectorModal } from '../Profile/ItemSelectorModal';
import { PetSelectorModal } from '../Profile/PetSelectorModal';
import { MountSelectorModal } from '../Profile/MountSelectorModal';
import { SkillSelectorModal } from '../Profile/SkillSelectorModal';
import { FAIRIES } from '../../utils/fairies';
import { useCardReader } from './useCardReader';

export interface CardFighterState {
    card: CardRead;
    name: string;
    /** Best estimate of the card totals (midpoint of the truncated display range). */
    totalDamage: number | null;
    totalHealth: number | null;
    profile: UserProfile | null;
    solve: SolveResult | null;
    notes: string[];
}

/**
 * The card prints 3 significant digits, TRUNCATED (Numbers.Format with RoundDown): "42.1b" is
 * anything in [42.1b, 42.2b). The midpoint is the best single estimate of the real value.
 */
export function cardTotalMidpoint(v: number | null): number | null {
    if (v == null || !(v > 0)) return null;
    if (v < 1000) return v;
    const unit = Math.pow(10, Math.floor(Math.log10(v)) - 2);
    return Math.floor(v / unit + 1e-9) * unit + unit / 2;
}

/** A card with nothing read: the starting point of the manual mode. */
function emptyCard(): CardRead {
    return {
        name: null, totalDamage: null, totalHealth: null, forgeLevel: null, forgeStars: null,
        items: CARD_ITEM_SLOTS.map(slot => ({ slot, age: null, idx: null, level: null, stars: null, hasSkin: null, confidence: 1 })),
        pets: [0, 1, 2].map(() => ({ rarity: null, id: null, level: null, stars: null, confidence: 1 })),
        mount: { rarity: null, id: null, level: null, stars: null, confidence: 1 },
        skills: [0, 1, 2].map(() => ({ skillId: null, level: null, stars: null, confidence: 1 })),
        fairy: null, stats: {}, warnings: [],
    };
}

/** Pad a read so every slot exists and can be edited, even the ones a screenshot did not show. */
function withAllSlots(c: CardRead): CardRead {
    const items = CARD_ITEM_SLOTS.map(slot => c.items.find(i => i.slot === slot)
        ?? { slot, age: null, idx: null, level: null, stars: null, hasSkin: null, confidence: 0 });
    const pad = <T,>(arr: T[], make: () => T) => [...arr, ...Array.from({ length: Math.max(0, 3 - arr.length) }, make)];
    return {
        ...c, items,
        pets: pad(c.pets, () => ({ rarity: null, id: null, level: null, stars: null, confidence: 0 })),
        skills: pad(c.skills, () => ({ skillId: null, level: null, stars: null, confidence: 0 })),
        mount: c.mount ?? { rarity: null, id: null, level: null, stars: null, confidence: 0 },
    };
}

/** ItemSelector / getItemImage slot names for the card slots. */
const IMAGE_SLOT: Record<string, string> = { Shoe: 'Shoes', Body: 'Body' };
const STAT_IDS = [
    'CriticalChance', 'CriticalMulti', 'BlockChance', 'HealthRegen', 'LifeSteal', 'DoubleDamageChance',
    'DamageMulti', 'MeleeDamageMulti', 'RangedDamageMulti', 'AttackSpeed', 'SkillDamageMulti',
    'SkillCooldownMulti', 'HealthMulti', 'MoveSpeed', 'AttackRange', 'ReflectChance',
];

type Picker =
    | { kind: 'item'; slot: string }
    | { kind: 'pet'; index: number }
    | { kind: 'mount' }
    | { kind: 'skill'; index: number }
    | null;

export function CardFighterInput({ mode, value, onChange, solverReady }: {
    /** Screenshot: upload first. Manual: start straight from an empty card to fill in. */
    mode: 'screenshot' | 'manual';
    value: CardFighterState | null;
    onChange: (v: CardFighterState | null) => void;
    solverReady: boolean;
}) {
    const { libs } = useStatLibraries();
    const { importProfileFromJsonString } = useProfile();
    const reader = useCardReader();
    const [reading, setReading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [card, setCard] = useState<CardRead | null>(value?.card ?? (mode === 'manual' ? emptyCard() : null));
    const [shots, setShots] = useState<string[]>([]);
    const [saved, setSaved] = useState(false);
    const [picker, setPicker] = useState<Picker>(null);

    useEffect(() => () => shots.forEach(u => URL.revokeObjectURL(u)), [shots]);

    const onFiles = async (files: FileList | null) => {
        if (!files?.length || !reader.ready) return;
        setReading(true);
        setError(null);
        setSaved(false);
        try {
            const list = Array.from(files);
            setShots(list.map(f => URL.createObjectURL(f)));
            const reads: CardRead[] = [];
            for (const f of list) reads.push(await reader.read(f));
            const merged = mergeCardReads(reads);
            setCard(merged ? withAllSlots(merged) : null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setReading(false);
        }
    };

    // Rebuild the profile and solve the trees whenever the reviewed card changes.
    const rebuilt = useMemo((): CardFighterState | null => {
        if (!card || !solverReady) return null;
        const totalDamage = cardTotalMidpoint(card.totalDamage);
        const totalHealth = cardTotalMidpoint(card.totalHealth);
        const { profile, notes } = profileFromCard(card, {
            skillLibrary: libs.skillLibrary,
            guildPositionLibrary: libs.guildTechTreePositionLibrary,
            guildUpgradeLibrary: libs.guildTechTreeUpgradeLibrary,
        });
        let solve: SolveResult | null = null;
        if (totalDamage && totalHealth) {
            solve = solveTrees(profile, { totalDamage, totalHealth }, {
                libs,
                techTreePositionLibrary: libs.techTreePositionLibrary,
                guildPositionLibrary: libs.guildTechTreePositionLibrary,
                guildUpgradeLibrary: libs.guildTechTreeUpgradeLibrary,
                skillLibrary: libs.skillLibrary,
            });
        } else {
            notes.push('Without Total Damage and Total Health the trees stay empty: enter both to rebuild them.');
        }
        return {
            card, name: card.name || 'Opponent', totalDamage, totalHealth,
            profile: solve?.profile ?? profile, solve, notes: [...notes, ...(solve?.notes ?? [])],
        };
    }, [card, solverReady, libs]);

    useEffect(() => { onChange(rebuilt); }, [rebuilt]); // eslint-disable-line react-hooks/exhaustive-deps

    const edit = (patch: Partial<CardRead>) => { setSaved(false); setCard(c => (c ? { ...c, ...patch } : c)); };
    const editItem = (slot: string, patch: Partial<CardItem>) =>
        edit({ items: card!.items.map(it => (it.slot === slot ? { ...it, ...patch } : it)) });
    const editPet = (k: number, patch: Partial<CardUnit>) => edit({ pets: card!.pets.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
    const editSkill = (k: number, patch: Partial<CardSkill>) => edit({ skills: card!.skills.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
    const num = (s: string) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };

    const saveProfile = () => {
        if (!rebuilt?.profile) return;
        importProfileFromJsonString(JSON.stringify({ ...rebuilt.profile, name: rebuilt.name }));
        setSaved(true);
    };

    return (
        <div className="space-y-3">
            {mode === 'screenshot' && (
            <div className="flex flex-col sm:flex-row gap-2">
                <label className={'flex-1 flex items-center justify-center gap-2 border-2 border-dashed rounded-xl p-3 text-sm cursor-pointer ' +
                    (reader.ready ? 'border-border hover:border-accent-primary/50' : 'border-border/40 opacity-60 cursor-wait')}>
                    {reading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {reading ? 'Reading screenshots' : reader.ready ? 'From profile card screenshots' : 'Loading the screenshot reader'}
                    <input type="file" accept="image/*" multiple className="hidden" disabled={!reader.ready || reading}
                        onChange={e => { onFiles(e.target.files); e.target.value = ''; }} />
                </label>
            </div>
            )}
            {mode === 'manual' && (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                    <PencilLine className="w-4 h-4" />
                    Pick each item, pet, mount and skill, then enter the card totals: the trees are rebuilt to match them.
                    <button onClick={() => { setCard(emptyCard()); setSaved(false); }} className="ml-auto underline hover:text-text-primary">Clear</button>
                </div>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}

            {card && (
                <div className="space-y-3 text-sm">
                    {shots.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto">
                            {shots.map((u, k) => (
                                <a key={k} href={u} target="_blank" rel="noreferrer" title="Open the screenshot">
                                    <img src={u} alt={`Screenshot ${k + 1}`} className="h-40 rounded-lg border border-border" />
                                </a>
                            ))}
                        </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <Field label="Name"><input value={card.name ?? ''} onChange={e => edit({ name: e.target.value })} className={INPUT} /></Field>
                        <Field label="Total Damage"><CompactInput value={card.totalDamage} onChange={v => edit({ totalDamage: v })} /></Field>
                        <Field label="Total Health"><CompactInput value={card.totalHealth} onChange={v => edit({ totalHealth: v })} /></Field>
                        <Field label="Forge Lv / stars">
                            <div className="flex gap-1">
                                <input type="number" value={card.forgeLevel ?? ''} onChange={e => edit({ forgeLevel: num(e.target.value) })} className={INPUT} />
                                <input type="number" min={0} max={3} value={card.forgeStars ?? ''} onChange={e => edit({ forgeStars: num(e.target.value) })} className={INPUT} />
                            </div>
                        </Field>
                    </div>

                    <Section title="Items">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {card.items.map(it => (
                                <ItemSlotCard key={it.slot} item={it}
                                    onPick={() => setPicker({ kind: 'item', slot: it.slot })}
                                    onChange={patch => editItem(it.slot, patch)} />
                            ))}
                        </div>
                    </Section>

                    <WeaponAnimationPicker card={card} onChange={weaponAnimation => edit({ weaponAnimation })} />

                    <Section title="Mount, pets and skills">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {card.mount && (
                                <UnitSlotCard kind="mount" label="Mount" unit={card.mount}
                                    onPick={() => setPicker({ kind: 'mount' })}
                                    onChange={patch => edit({ mount: { ...card.mount!, ...patch } })} />
                            )}
                            {card.pets.map((u, k) => (
                                <UnitSlotCard key={`p${k}`} kind="pet" label={`Pet ${k + 1}`} unit={u}
                                    onPick={() => setPicker({ kind: 'pet', index: k })}
                                    onChange={patch => editPet(k, patch)} />
                            ))}
                            {card.skills.map((sk, k) => (
                                <SkillSlotCard key={`s${k}`} label={`Skill ${k + 1}`} skill={sk}
                                    onPick={() => setPicker({ kind: 'skill', index: k })}
                                    onChange={patch => editSkill(k, patch)} />
                            ))}
                            <div className="rounded-lg border border-border p-2 space-y-1">
                                <div className="text-[10px] uppercase tracking-wider text-text-muted">Fairy</div>
                                <select value={card.fairy?.name ?? ''} className={INPUT}
                                    onChange={e => edit({ fairy: e.target.value ? { name: e.target.value, level: card.fairy?.level ?? 1 } : null })}>
                                    <option value="">None</option>
                                    {FAIRIES.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                                </select>
                                {card.fairy && (
                                    <input type="number" min={1} placeholder="Lv" value={card.fairy.level ?? ''} className={INPUT}
                                        onChange={e => edit({ fairy: { ...card.fairy!, level: num(e.target.value) } })} />
                                )}
                            </div>
                        </div>
                    </Section>

                    <Section title="Stat totals (as printed on the card)">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                            {Object.entries(card.stats).map(([id, v]) => (
                                <div key={id} className="flex items-center justify-between gap-2 bg-bg-input/40 rounded px-2 py-1">
                                    <span className="text-text-muted text-xs truncate">{id}</span>
                                    <div className="flex items-center gap-1">
                                        <input type="number" step="0.01" value={v}
                                            onChange={e => edit({ stats: { ...card.stats, [id]: num(e.target.value) ?? 0 } })}
                                            className="w-20 bg-transparent text-right font-mono" />
                                        <span className="text-text-muted">%</span>
                                        <button aria-label={`Remove ${id}`} className="text-text-muted hover:text-red-400"
                                            onClick={() => { const s = { ...card.stats }; delete s[id]; edit({ stats: s }); }}>
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <AddStat existing={Object.keys(card.stats)} onAdd={id => edit({ stats: { ...card.stats, [id]: 0 } })} />
                    </Section>

                    {rebuilt?.solve && <SolveSummary solve={rebuilt.solve} />}
                    {[...card.warnings, ...(rebuilt?.notes ?? [])].map((n, k) => (
                        <p key={k} className="text-xs text-amber-300/90 flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{n}</p>
                    ))}

                    <button disabled={!rebuilt?.profile} onClick={saveProfile}
                        className="px-3 py-1.5 rounded-lg border border-border flex items-center gap-2 disabled:opacity-40 hover:border-accent-primary/60">
                        <Save className="w-4 h-4" /> {saved ? 'Saved as a new profile' : 'Save as a new profile'}
                    </button>
                </div>
            )}

            {picker?.kind === 'item' && card && (() => {
                const it = card.items.find(i => i.slot === picker.slot)!;
                return (
                    <ItemSelectorModal isOpen isPvp slot={picker.slot === 'Shoe' ? 'Shoe' : picker.slot}
                        current={it.age != null && it.idx != null ? { age: it.age, idx: it.idx, level: it.level ?? 1, rarity: 'Common', secondaryStats: [] } : null}
                        onClose={() => setPicker(null)}
                        onSelect={sel => {
                            if (sel) editItem(picker.slot, { age: sel.age, idx: sel.idx, level: sel.level ?? it.level, confidence: 1 });
                            setPicker(null);
                        }} />
                );
            })()}
            {picker?.kind === 'pet' && card && (
                <PetSelectorModal isOpen context="pvp"
                    onClose={() => setPicker(null)}
                    onSelect={pet => {
                        if (pet) editPet(picker.index, { rarity: pet.rarity, id: pet.id, level: pet.level ?? card.pets[picker.index].level, confidence: 1 });
                        setPicker(null);
                    }} />
            )}
            {picker?.kind === 'mount' && card && (
                <MountSelectorModal isOpen context="pvp"
                    onClose={() => setPicker(null)}
                    onSelect={(rarity, id, level) => {
                        if (rarity && id != null) edit({ mount: { ...card.mount!, rarity, id, level: level ?? card.mount?.level ?? null, confidence: 1 } });
                        setPicker(null);
                    }} />
            )}
            {picker?.kind === 'skill' && card && (
                <SkillSelectorModal isOpen isPvp
                    excludeSkillIds={card.skills.filter((_, j) => j !== picker.index).map(s => s.skillId).filter(Boolean) as string[]}
                    onClose={() => setPicker(null)}
                    onSelect={sk => {
                        editSkill(picker.index, { skillId: sk.id, level: sk.level ?? card.skills[picker.index].level, confidence: 1 });
                        setPicker(null);
                    }} />
            )}
        </div>
    );
}

const INPUT = 'w-full bg-bg-input border border-border rounded px-2 py-1 font-mono text-sm';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-widest text-text-muted font-bold">{title}</div>
            {children}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="space-y-0.5 block">
            <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
            {children}
        </label>
    );
}

/** The source crop next to what it was read as: the user compares the two at a glance. */
function Evidence({ cropUrl, children, onPick, title }: { cropUrl?: string; children: React.ReactNode; onPick: () => void; title: string }) {
    return (
        <div className="flex items-center gap-1.5">
            {cropUrl ? (
                <img src={cropUrl} alt="Read from the screenshot" title="Read from the screenshot"
                    className="w-12 h-12 object-contain rounded border border-border bg-black/40" />
            ) : (
                <div className="w-12 h-12 rounded border border-dashed border-border/60 flex items-center justify-center text-[9px] text-text-muted text-center">no crop</div>
            )}
            <span className="text-text-muted">&rarr;</span>
            <button onClick={onPick} title={title}
                className="w-12 h-12 rounded border border-border hover:border-accent-primary/70 overflow-hidden flex items-center justify-center bg-bg-input">
                {children}
            </button>
        </div>
    );
}

function StarsInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
    return (
        <div className="flex items-center gap-0.5" title="Ascension stars">
            {[1, 2, 3].map(n => (
                <button key={n} onClick={() => onChange(value === n ? n - 1 : n)} aria-label={`${n} stars`}>
                    <Star className={'w-3.5 h-3.5 ' + ((value ?? 0) >= n ? 'fill-amber-400 text-amber-400' : 'text-text-muted')} />
                </button>
            ))}
        </div>
    );
}

function LevelInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
    return (
        <input type="number" min={1} placeholder="Lv ?" value={value ?? ''}
            onChange={e => { const v = parseInt(e.target.value); onChange(Number.isFinite(v) && v > 0 ? v : null); }}
            className={'w-full bg-bg-input border rounded px-2 py-0.5 font-mono text-sm ' + (value == null ? 'border-amber-500/60' : 'border-border')} />
    );
}

function ItemSlotCard({ item, onPick, onChange }: { item: CardItem; onPick: () => void; onChange: (p: Partial<CardItem>) => void }) {
    const { selectedVersion } = useGameDataContext();
    const { data: autoItemMapping } = useGameData<any>('AutoItemMapping.json');
    const img = item.age != null && item.idx != null
        ? getItemImage(AGES[item.age], IMAGE_SLOT[item.slot] ?? item.slot, item.idx, autoItemMapping, selectedVersion)
        : null;
    const ok = item.age != null && item.idx != null && item.level != null;
    return (
        <div className={'rounded-lg border p-2 space-y-1 ' + (ok ? 'border-border' : 'border-amber-500/50')}>
            <div className="text-[10px] uppercase tracking-wider text-text-muted flex justify-between">
                <span>{item.slot}</span>{item.hasSkin && <span className="text-pink-300">skin</span>}
            </div>
            <Evidence cropUrl={item.cropUrl} onPick={onPick} title="Choose the item">
                {img ? <img src={img} alt={item.slot} className="w-full h-full object-contain" /> : <Plus className="w-4 h-4 text-text-muted" />}
            </Evidence>
            <select value={item.age ?? ''} className={INPUT}
                onChange={e => onChange({ age: e.target.value === '' ? null : parseInt(e.target.value) })}>
                <option value="">Age ?</option>
                {AGES.map((a, k) => <option key={a} value={k}>{a}</option>)}
            </select>
            <div className="flex items-center gap-1">
                <LevelInput value={item.level} onChange={level => onChange({ level })} />
                <StarsInput value={item.stars} onChange={stars => onChange({ stars })} />
            </div>
        </div>
    );
}

function UnitSlotCard({ kind, label, unit, onPick, onChange }: {
    kind: 'pet' | 'mount'; label: string; unit: CardUnit; onPick: () => void; onChange: (p: Partial<CardUnit>) => void;
}) {
    const { selectedVersion } = useGameDataContext();
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const sheet = spriteMapping?.[kind === 'pet' ? 'pets' : 'mounts'];
    const entry = sheet?.mapping && unit.rarity && unit.id != null
        ? Object.entries<any>(sheet.mapping).find(([, v]) => v.rarity === unit.rarity && v.id === unit.id)
        : undefined;
    const ok = !!entry && unit.level != null;
    return (
        <div className={'rounded-lg border p-2 space-y-1 ' + (ok ? 'border-border' : 'border-amber-500/50')}>
            <div className="text-[10px] uppercase tracking-wider text-text-muted truncate">
                {label}{entry ? `: ${entry[1].name}` : ''}{unit.rarity ? ` (${unit.rarity})` : ''}
            </div>
            <Evidence cropUrl={unit.cropUrl} onPick={onPick} title={`Choose the ${kind}`}>
                {entry ? (
                    <div className="w-full h-full" style={getRarityBgStyle(unit.rarity!)}>
                        <SpriteSheetIcon
                            textureSrc={getAscensionTexturePath(kind === 'pet' ? 'Pets' : 'MountIcons', unit.stars ?? 0, selectedVersion)}
                            spriteWidth={sheet.sprite_size.width} spriteHeight={sheet.sprite_size.height}
                            sheetWidth={sheet.texture_size.width} sheetHeight={sheet.texture_size.height}
                            iconIndex={parseInt(entry[0])} className="w-full h-full" />
                    </div>
                ) : <Cat className="w-4 h-4 text-text-muted" />}
            </Evidence>
            <div className="flex items-center gap-1">
                <LevelInput value={unit.level} onChange={level => onChange({ level })} />
                <StarsInput value={unit.stars} onChange={stars => onChange({ stars })} />
            </div>
        </div>
    );
}

function SkillSlotCard({ label, skill, onPick, onChange }: {
    label: string; skill: CardSkill; onPick: () => void; onChange: (p: Partial<CardSkill>) => void;
}) {
    const { selectedVersion } = useGameDataContext();
    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const sheet = spriteMapping?.skills;
    const entry = sheet?.mapping && skill.skillId
        ? Object.entries<any>(sheet.mapping).find(([, v]) => v.name === skill.skillId)
        : undefined;
    const rarity = skill.skillId ? skillLibrary?.[skill.skillId]?.Rarity : null;
    const ok = !!skill.skillId && skill.level != null;
    return (
        <div className={'rounded-lg border p-2 space-y-1 ' + (ok ? 'border-border' : 'border-amber-500/50')}>
            <div className="text-[10px] uppercase tracking-wider text-text-muted truncate">
                {label}{skill.skillId ? `: ${skill.skillId}` : ''}{rarity ? ` (${rarity})` : ''}
            </div>
            <Evidence cropUrl={skill.cropUrl} onPick={onPick} title="Choose the skill">
                {entry ? (
                    <div className="w-full h-full" style={rarity ? getRarityBgStyle(rarity) : undefined}>
                        <SpriteSheetIcon
                            textureSrc={getAscensionTexturePath('SkillIcons', skill.stars ?? 0, selectedVersion)}
                            spriteWidth={sheet.sprite_size.width} spriteHeight={sheet.sprite_size.height}
                            sheetWidth={sheet.texture_size.width} sheetHeight={sheet.texture_size.height}
                            iconIndex={parseInt(entry[0])} className="w-full h-full" />
                    </div>
                ) : <Plus className="w-4 h-4 text-text-muted" />}
            </Evidence>
            <div className="flex items-center gap-1">
                <LevelInput value={skill.level} onChange={level => onChange({ level })} />
                <StarsInput value={skill.stars} onChange={stars => onChange({ stars })} />
            </div>
        </div>
    );
}

/**
 * The weapon's windup comes from the weapon, or from a weapon skin when one is worn: the skin's
 * animation replaces the weapon's (WeaponLibrary rows at Age -1000 melee / -1001 ranged).
 */
function WeaponAnimationPicker({ card, onChange }: { card: CardRead; onChange: (v: NonNullable<CardRead['weaponAnimation']>) => void }) {
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const weapon = card.items.find(i => i.slot === 'Weapon');
    const base = weapon?.age != null && weapon.idx != null
        ? weaponLibrary?.[`{'Age': ${weapon.age}, 'Type': 'Weapon', 'Idx': ${weapon.idx}}`] : null;
    const ranged = (base?.AttackRange ?? 0) >= 1;
    const anim = card.weaponAnimation ?? (weapon?.hasSkin ? { source: 'skin' as const, idx: null } : { source: 'weapon' as const });
    const skins = Object.values<any>(skinsLibrary || {})
        .filter(s => s?.SkinId?.Type === 'Weapon')
        .map(s => {
            const idx = s.SkinId.Idx as number;
            const row = weaponLibrary?.[`{'Age': ${ranged ? -1001 : -1000}, 'Type': 'Weapon', 'Idx': ${idx}}`];
            return { idx, name: (s.BaseSetId || `Skin ${idx}`).replace(/Set$/, ''), windup: row?.WindupTime as number | undefined };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    const chosen = anim.source === 'skin' && anim.idx != null ? skins.find(s => s.idx === anim.idx) : null;
    const windup = anim.source === 'skin' ? chosen?.windup : base?.WindupTime;
    const needsChoice = anim.source === 'skin' && anim.idx == null;
    return (
        <Section title="Weapon animation (windup)">
            <div className={'flex flex-wrap items-center gap-2 rounded-lg border p-2 ' + (needsChoice ? 'border-amber-500/60' : 'border-border')}>
                {(['weapon', 'skin'] as const).map(src => (
                    <label key={src} className="flex items-center gap-1 text-sm cursor-pointer">
                        <input type="radio" checked={anim.source === src}
                            onChange={() => onChange(src === 'weapon' ? { source: 'weapon' } : { source: 'skin', idx: null })} />
                        {src === 'weapon' ? 'Weapon' : 'Weapon skin'}
                    </label>
                ))}
                {anim.source === 'skin' && (
                    <select value={anim.idx ?? ''} onChange={e => onChange({ source: 'skin', idx: e.target.value === '' ? null : parseInt(e.target.value) })}
                        className="bg-bg-input border border-border rounded px-2 py-1 text-sm">
                        <option value="">Which skin?</option>
                        {skins.map(s => <option key={s.idx} value={s.idx}>{s.name}{s.windup != null ? ` (windup ${s.windup.toFixed(2)}s)` : ''}</option>)}
                    </select>
                )}
                <span className="text-xs text-text-muted ml-auto">
                    {weapon?.hasSkin ? 'The card shows a skin on the weapon. ' : ''}
                    Windup {windup != null ? `${windup.toFixed(2)}s` : 'unknown'}{ranged ? ', ranged' : base ? ', melee' : ''}
                </span>
            </div>
        </Section>
    );
}

function AddStat({ existing, onAdd }: { existing: string[]; onAdd: (id: string) => void }) {
    const free = STAT_IDS.filter(id => !existing.includes(id));
    if (!free.length) return null;
    return (
        <select value="" onChange={e => e.target.value && onAdd(e.target.value)}
            className="mt-1 bg-bg-input border border-border rounded px-2 py-1 text-sm">
            <option value="">Add a stat line</option>
            {free.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
    );
}

/** Accepts "42.1b", "384b", "1.2t" or a plain number. */
function CompactInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
    const [text, setText] = useState(value != null ? formatNumber(value) : '');
    useEffect(() => { setText(value != null ? formatNumber(value) : ''); }, [value]);
    return (
        <input value={text} placeholder="e.g. 42.1b" onChange={e => setText(e.target.value)}
            onBlur={() => onChange(parseCompactNumber(text.trim()) ?? null)}
            className={INPUT} />
    );
}

function SolveSummary({ solve }: { solve: SolveResult }) {
    const ok = Math.abs(solve.error.damage) < 0.005 && Math.abs(solve.error.health) < 0.005;
    const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
    return (
        <div className={'rounded-lg border p-2 text-xs space-y-1 ' + (ok ? 'border-green-500/40' : 'border-amber-500/50')}>
            <div className="flex items-center gap-1 font-bold">
                {ok ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
                Trees rebuilt from the card totals
            </div>
            <div>Damage {formatNumber(solve.achieved.damage)} ({pct(solve.error.damage)}), Health {formatNumber(solve.achieved.health)} ({pct(solve.error.health)})</div>
            <div className="text-text-muted">
                Damage nodes {(solve.progress.damage * 100).toFixed(0)}% of the way, health nodes {(solve.progress.health * 100).toFixed(0)}%
                {solve.progress.otherSkillPassiveLevel > 0 ? `, other skills at Lv.${solve.progress.otherSkillPassiveLevel}` : ''}
            </div>
        </div>
    );
}
