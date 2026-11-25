import { useCallback, useState, type ReactNode } from 'react';
import { Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';
import { SecondaryStatCard } from '../UI/SecondaryStatCard';
import { ItemPicker, ItemThumbnail } from './ItemPicker';
import { SLOTS, Roll, blankRoll, bonusOptions, statCount } from './model';
import { cn } from '../../lib/utils';

const selectClass = 'w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent-primary';

export function Select({ label, value, onChange, children }: { label: string; value: string | number; onChange: (value: string) => void; children: ReactNode }) {
    return (
        <label className="block text-xs text-text-secondary space-y-1">
            <span>{label}</span>
            <select aria-label={label} className={selectClass} value={value} onChange={e => onChange(e.target.value)}>{children}</select>
        </label>
    );
}

interface RollEditorProps {
    title: string;
    rolls: Roll[];
    selected: number;
    onSelect: (index: number) => void;
    onChange: (rolls: Roll[]) => void;
    config: any;
    ascension: number;
    version: string;
    forgeLevel: string | number;
    artwork: (age: number, type: number, idx: number, config: any) => string | null;
    historyOpen: boolean;
    onHistoryToggle: (open: boolean) => void;
    maxRolls?: number;
}

export function RollEditor({ title, rolls, selected, onSelect, onChange, config, ascension, version, forgeLevel, artwork, historyOpen, onHistoryToggle, maxRolls = 100 }: RollEditorProps) {
    const [picker, setPicker] = useState(false);
    const closePicker = useCallback(() => setPicker(false), []);
    const active = rolls[selected] ?? rolls[0];

    const itemName = (r: Roll) => String(r.idx) === '' ? 'Any ' + SLOTS[r.type] : config.names[`${r.age}:${r.type}:${r.idx}`] ?? 'Item unavailable in this data';
    const patchRoll = (patch: Partial<Roll>) => onChange(rolls.map((r, i) => i === selected ? { ...r, ...patch } : r));
    const setBonus = (index: number, patch: Partial<Roll['stats'][number]>) => {
        const length = Math.max(statCount(config, ascension, active.age), active.stats.length);
        const stats = Array.from({ length }, (_, i) => ({ ...active.stats[i] ?? { k: '', percent: '' } }));
        stats[index] = { ...stats[index], ...patch };
        patchRoll({ stats });
    };
    const addRoll = () => {
        if (rolls.length >= maxRolls) return;
        onChange([...rolls, blankRoll(active.age, active.type)]);
        onSelect(rolls.length);
        onHistoryToggle(true);
    };
    const removeRoll = () => {
        const list = rolls.filter((_, i) => i !== selected);
        onChange(list.length ? list : [blankRoll()]);
        onSelect(Math.max(0, Math.min(selected, list.length - 1)));
    };
    const locked = (age: number) => (config.ageUnlockAscension?.[age] ?? 0) > ascension;
    const count = statCount(config, ascension, active.age);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{title}</h2>
                <Button size="sm" onClick={addRoll} disabled={rolls.length >= maxRolls}><Plus size={15} className="mr-1" />Add forge</Button>
            </div>
            <details open={historyOpen} onToggle={e => onHistoryToggle(e.currentTarget.open)} className="border border-border rounded-xl p-3">
                <summary className="cursor-pointer text-sm font-semibold">Roll history · {rolls.length} recorded</summary>
                <div className="max-h-60 overflow-auto mt-3 grid sm:grid-cols-2 gap-2">
                    {rolls.map((r, i) => (
                        <button key={i} aria-current={selected === i ? 'step' : undefined} onClick={() => onSelect(i)} className={cn('flex items-center gap-2 text-left p-2 rounded-lg border', selected === i ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:bg-white/5')}>
                            <ItemThumbnail size="w-10 h-10" src={!r.skip && String(r.idx) !== '' ? artwork(r.age, r.type, Number(r.idx), config) : null} name={itemName(r)} />
                            <span className="min-w-0">
                                <span className="text-xs text-accent-primary">Forge #{i + 1}</span>
                                <span className="block text-xs truncate">{r.skip ? 'Unknown roll' : itemName(r)}</span>
                                <span className="text-[10px] text-text-muted">{r.skip ? 'Preserves seed position' : config.ageNames[r.age] + ' · ' + SLOTS[r.type]}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </details>
            <div className="flex items-center justify-between">
                <div className="flex gap-2 items-center">
                    <Button aria-label="Previous forge" variant="ghost" size="sm" disabled={selected === 0} onClick={() => onSelect(selected - 1)}><ChevronLeft size={18} /></Button>
                    <h3 className="font-semibold">Forge #{selected + 1}</h3>
                    <Button aria-label="Next forge" variant="ghost" size="sm" disabled={selected >= rolls.length - 1} onClick={() => onSelect(selected + 1)}><ChevronRight size={18} /></Button>
                </div>
                <button aria-label={`Remove forge ${selected + 1}`} onClick={removeRoll} className="p-2 text-text-muted hover:text-red-400"><Trash2 size={17} /></button>
            </div>
            <label className="flex gap-2 items-center text-sm text-text-secondary">
                <input type="checkbox" checked={!!active.skip} onChange={e => patchRoll({ skip: e.target.checked })} />Unknown roll or missing result
            </label>
            {!active.skip && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <Select label="Age" value={active.age} onChange={v => patchRoll({ age: Number(v), idx: '' })}>
                            {config.ageNames.map((name: string, a: number) => (
                                <option key={a} value={a} disabled={locked(a)}>{name}{locked(a) ? ' · Ascension ' + config.ageUnlockAscension[a] : ''}</option>
                            ))}
                        </Select>
                        <Select label="Equipment" value={active.type} onChange={v => patchRoll({ type: Number(v), idx: '' })}>
                            {SLOTS.map((name, t) => <option key={t} value={t}>{name}</option>)}
                        </Select>
                    </div>
                    <button className="w-full flex items-center gap-4 border border-border rounded-xl p-3 bg-black/10 hover:border-accent-primary/50 text-left" onClick={() => setPicker(true)}>
                        <ItemThumbnail size="w-20 h-20" src={String(active.idx) === '' ? null : artwork(active.age, active.type, Number(active.idx), config)} name={itemName(active)} />
                        <span>
                            <span className="block font-semibold">{itemName(active)}</span>
                            <span className="block text-xs text-text-secondary mt-1">Browse item images</span>
                        </span>
                    </button>
                    <div className="flex items-end gap-3">
                        <div className="flex-1"><Input label="Displayed item level (optional)" type="number" min={1} max={149} value={active.displayLevel ?? ''} onChange={e => patchRoll({ displayLevel: e.target.value })} /></div>
                        <Button variant="ghost" size="sm" onClick={() => patchRoll({ idx: '' })}>Name unknown</Button>
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold mb-2">Item substats</h3>
                        <div className="grid sm:grid-cols-2 gap-3">
                            {Array.from({ length: Math.max(count, active.stats.length) }, (_, i) => {
                                const s = active.stats[i] ?? { k: '', percent: '' };
                                const range = config.statRanges[Number(s.k)];
                                return (
                                    <SecondaryStatCard
                                        key={`${selected}:${i}`}
                                        label={`Forge ${selected + 1} substat ${i + 1}`}
                                        statId={String(s.k)}
                                        value={Number(s.percent.replace(',', '.')) || 0}
                                        options={bonusOptions(config, active, i)}
                                        onStatIdChange={k => setBonus(i, { k, percent: '' })}
                                        onValueChange={() => {}}
                                        onRemove={() => setBonus(i, { k: '', percent: '' })}
                                        range={String(s.k) !== '' && range ? { min: range.lower, max: range.upper } : null}
                                        valueInput={
                                            <label className="flex gap-2 items-center">
                                                <input aria-label={`Forge ${selected + 1} substat ${i + 1} percentage`} type="text" inputMode="decimal" value={s.percent} onFocus={e => e.target.select()} onChange={e => { if (/^-?[0-9.,]*$/.test(e.target.value)) setBonus(i, { percent: e.target.value }); }} placeholder="Exact value shown" className="w-full bg-bg-input border border-border rounded px-2 py-1.5 text-sm font-mono focus:border-accent-primary outline-none" />
                                                <span className="text-text-muted text-xs">%</span>
                                            </label>
                                        }
                                    />
                                );
                            })}
                        </div>
                        {count === 0 && !active.stats.length && <p className="text-xs text-text-muted">No substats at this age before ascension. Optional item levels can provide evidence, but recovery is experimental.</p>}
                        <p className="text-[11px] text-text-muted mt-2">Use the item's own values. Keep every displayed decimal, including trailing zeros. Values are kept as entered. The bundled ranges are a reference; values the model cannot produce may return no match.</p>
                    </div>
                </div>
            )}
            {picker && <ItemPicker roll={active} config={config} version={version} ascension={ascension} forgeLevel={forgeLevel} onClose={closePicker} onSelect={roll => { patchRoll(roll); closePicker(); }} />}
        </div>
    );
}
