import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Minus, Plus } from 'lucide-react';
import { SecondaryStatCard } from "../UI/SecondaryStatCard";
import { getAgeBgStyle, getAgeIconStyle } from "../../lib/utils";
import { GameAssetIcon } from '../UI/GameAssetIcon';
import { getItemImage } from '../../utils/itemAssets';
import { resolveTextureVersion } from '../../utils/ascensionUtils';
import { useGameData } from '../../hooks/useGameData';
import { LATEST, SLOTS, Roll, bonusOptions, statCount } from './model';

export function usePredictorArtwork(version:string){
    const {data:mapping}=useGameData<any>('AutoItemMapping.json');
    return (age:number,type:number,idx:number,config:any)=>!config.ageNames[age]?null:getItemImage(config.ageNames[age],SLOTS[type],idx,mapping,resolveTextureVersion(version==='legacy211'?'2026_10_27_09_45':LATEST));
}
export function ItemThumbnail({src,name,size='w-14 h-14'}:{src:string|null;name:string;size?:string}){
    const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[src]);
    return <span className={`${size} shrink-0 inline-flex items-center justify-center rounded-lg bg-black/20 border border-white/5`}>{src&&!failed?<img src={src} alt={name} loading="lazy" className="w-full h-full object-contain" onError={()=>setFailed(true)}/>:<GameAssetIcon asset={{icon:'Anvil'}} size={24}/>}</span>;
}
export function ItemPicker({roll, config, version, ascension, forgeLevel, onSelect, onClose}: {
    roll: Roll; config: any; version: string; ascension: number; forgeLevel: string | number;
    onSelect: (roll: Roll) => void; onClose: () => void;
}) {
    const [draft, setDraft] = useState<Roll>(() => ({...roll, stats: roll.stats.filter(s => String(s.k) !== '' || s.percent !== '')}));
    const dialog = useRef<HTMLDialogElement>(null);
    const artwork = usePredictorArtwork(version);
    const texture = resolveTextureVersion(version === 'legacy211' ? '2026_10_27_09_45' : LATEST);
    const {age, type, idx} = draft;
    const indices: number[] = (config.items[age] ?? []).find((group: any) => group.type === type)?.indices ?? [];
    const locked = (a: number) => (config.ageUnlockAscension?.[a] ?? 0) > ascension;
    const name = config.names[`${age}:${type}:${idx}`];
    const slots = statCount(config, ascension, age);
    const heading = 'text-sm font-bold uppercase tracking-wider text-text-muted';
    useEffect(() => {
        const node = dialog.current;
        const overflow = document.body.style.overflow;
        node?.showModal();
        document.body.style.overflow = 'hidden';
        return () => { node?.close(); document.body.style.overflow = overflow; };
    }, []);
    function patch(next: Partial<Roll>) {
        setDraft(previous => ({...previous, ...next}));
    }
    function changeGroup(nextAge: number, nextType: number) {
        if (nextAge === age && nextType === type) return;
        patch({age: nextAge, type: nextType, idx: '', stats: []});
    }
    function changeLevel(delta: number) {
        patch({displayLevel: Math.min(149, Math.max(1, (Number(draft.displayLevel) || 0) + delta))});
    }
    return createPortal(<dialog ref={dialog} aria-labelledby="forge-picker-title"
        onCancel={e => { e.preventDefault(); onClose(); }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        className="m-auto w-[calc(100%-1.5rem)] max-w-7xl h-[90dvh] max-h-[90dvh] rounded-2xl border border-border bg-bg-primary text-text-primary shadow-2xl backdrop:bg-black/80 backdrop:backdrop-blur-sm">
        <form className="flex h-full flex-col" onSubmit={e => { e.preventDefault(); if (!locked(age)) onSelect(draft); }}>
            <header className="flex items-center gap-3 border-b border-border p-4 sm:p-5">
                <div className="rounded-xl bg-accent-primary/10 p-3"><GameAssetIcon asset={{icon:'Anvil'}} size={30}/></div>
                <div className="flex-1"><h2 id="forge-picker-title" className="text-xl font-bold sm:text-2xl">Select {SLOTS[type]}</h2><p className="text-sm text-text-muted">Forge Level {forgeLevel}</p></div>
                <button type="button" onClick={onClose} aria-label="Close item picker" className="rounded-lg p-2 text-text-muted hover:bg-white/5"><X size={22}/></button>
            </header>
            <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(8rem,20%)_minmax(0,1fr)_minmax(15rem,28%)] md:overflow-hidden">
                <aside className="border-b border-border p-3 md:overflow-y-auto md:border-b-0 md:border-r">
                    <label className={heading}>Equipment
                        <select value={type} onChange={e => changeGroup(age, Number(e.target.value))} className="mb-4 mt-2 w-full rounded-lg border border-border bg-bg-input p-2 text-sm font-normal normal-case text-text-primary">
                            {SLOTS.map((label, t) => <option key={label} value={t}>{label}</option>)}
                        </select>
                    </label>
                    <h3 className={heading}>Age</h3>
                    <div className="mt-2 grid grid-cols-2 gap-1 md:grid-cols-1">
                        {config.ageNames.map((label: string, a: number) => <button type="button" key={label}
                            disabled={locked(a)} aria-pressed={a === age} onClick={() => changeGroup(a, type)}
                            className={`flex min-w-0 items-center gap-2 rounded-lg border-2 p-2 text-left text-sm disabled:opacity-40 ${a === age ? 'border-accent-primary bg-accent-primary/15 text-accent-primary' : 'border-transparent text-text-secondary hover:bg-white/5'}`}>
                            <span style={getAgeIconStyle(a, 24, texture)} className="shrink-0 rounded bg-white/90"/>
                            <span>{label}{locked(a) && <small className="block">Ascension {config.ageUnlockAscension[a]}</small>}</span>
                        </button>)}
                    </div>
                </aside>
                <section className="p-4 sm:p-5 md:overflow-y-auto">
                    <h3 className={`${heading} mb-4 border-b border-border pb-3`}>Available items</h3>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                        {indices.map(item => {
                            const label = config.names[`${age}:${type}:${item}`] ?? `Item #${item}`;
                            const selected = String(idx) === String(item);
                            return <button type="button" key={item} aria-pressed={selected} disabled={locked(age)}
                                onClick={() => patch({idx: item})} className={`flex min-w-0 flex-col items-center gap-1 rounded-xl border-2 p-2 text-xs ${selected ? 'border-accent-primary bg-accent-primary/10 shadow-lg shadow-accent-primary/15' : 'border-border bg-white/5 hover:border-accent-primary/50'}`}>
                                <span className="rounded-lg" style={getAgeBgStyle(age)}><ItemThumbnail src={artwork(age,type,item,config)} name="" size="h-12 w-12"/></span>{label}
                            </button>;
                        })}
                    </div>
                    {!indices.length && <p className="text-sm text-text-muted">No items available.</p>}
                </section>
                <aside className="space-y-5 border-t border-border p-4 sm:p-5 md:overflow-y-auto md:border-l md:border-t-0">
                    <div className="flex items-center gap-3"><ItemThumbnail src={name ? artwork(age,type,Number(idx),config) : null} name=""/><div><p className="font-bold">{name || 'Any item'}</p><p className="text-sm text-text-muted">{config.ageNames[age]} · {SLOTS[type]}</p></div></div>
                    <div>
                        <label htmlFor="forge-observed-level" className={heading}>Item level <span className="normal-case font-normal">(optional)</span></label>
                        <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-bg-secondary p-2">
                            <button type="button" aria-label="Decrease item level" onClick={() => changeLevel(-1)} className="rounded-xl border border-border p-2"><Minus size={20}/></button>
                            <input id="forge-observed-level" type="number" min={1} max={149} placeholder="Unknown" value={draft.displayLevel ?? ''} onChange={e => patch({displayLevel:e.target.value})} className="min-w-0 flex-1 bg-transparent text-center text-lg font-bold"/>
                            <button type="button" aria-label="Increase item level" onClick={() => changeLevel(1)} className="rounded-xl bg-accent-primary p-2 text-black"><Plus size={20}/></button>
                        </div>
                    </div>
                    <div>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className={heading}>Passive stats ({draft.stats.filter(s => String(s.k) !== '').length}/{slots})</h3>
                            {draft.stats.length < slots && <button type="button" className="text-sm text-accent-primary" onClick={() => patch({stats:[...draft.stats,{k:'',percent:''}]})}>+ Add Stat</button>}
                        </div>
                        {!slots && <p className="text-sm text-text-muted">No passive stats for this age and ascension.</p>}
                        <div className="space-y-3">{draft.stats.map((stat, i) => {
                            const update = (k: string | number, percent: string) => patch({stats:draft.stats.map((s,j) => j === i ? {k,percent} : s)});
                            const range = String(stat.k) === '' ? null : config.statRanges[Number(stat.k)];
                            return <SecondaryStatCard key={i} label={`Passive stat ${i+1}`} statId={String(stat.k)}
                                value={Number(stat.percent.replace(',','.')) || 0} options={bonusOptions(config,draft,i)}
                                onStatIdChange={k => update(k,'')} onValueChange={() => {}}
                                onRemove={() => patch({stats:draft.stats.filter((_,j) => i !== j)})}
                                range={range ? {min:range.lower,max:range.upper} : null}
                                valueInput={<input aria-label={`Passive stat ${i+1} percentage`} type="text" inputMode="decimal"
                                    value={stat.percent} onChange={e => update(stat.k,e.target.value)} placeholder="Percentage"
                                    className="w-full rounded border border-border bg-bg-input p-2 text-sm"/>}/>;
                        })}</div>
                    </div>
                </aside>
            </div>
            <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-border p-3">
                {name && <button type="button" className="mr-auto px-2 text-sm text-text-secondary" onClick={() => patch({idx:''})}>Use any item</button>}
                <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2">Cancel</button>
                <button type="submit" disabled={locked(age)} className="rounded-lg bg-accent-primary px-4 py-2 font-bold text-black disabled:opacity-40">Save forge</button>
            </footer>
        </form>
    </dialog>, document.body);
}
