import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search } from 'lucide-react';
import { ItemSelectionCard } from '../UI/ItemSelectionCard';
import { GameAssetIcon } from '../UI/GameAssetIcon';
import { getItemImage } from '../../utils/itemAssets';
import { resolveTextureVersion } from '../../utils/ascensionUtils';
import { useGameData } from '../../hooks/useGameData';
import { LATEST, SLOTS, Roll } from './model';

export function usePredictorArtwork(version:string){
    const {data:mapping}=useGameData<any>('AutoItemMapping.json');
    return (age:number,type:number,idx:number,config:any)=>!config.ageNames[age]?null:getItemImage(config.ageNames[age],SLOTS[type],idx,mapping,resolveTextureVersion(version==='legacy211'?'2026_10_27_09_45':LATEST));
}
export function ItemThumbnail({src,name,size='w-14 h-14'}:{src:string|null;name:string;size?:string}){
    const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[src]);
    return <span className={`${size} shrink-0 inline-flex items-center justify-center rounded-lg bg-black/20 border border-white/5`}>{src&&!failed?<img src={src} alt={name} loading="lazy" className="w-full h-full object-contain" onError={()=>setFailed(true)}/>:<GameAssetIcon asset={{icon:'Anvil'}} size={24}/>}</span>;
}
export function ItemPicker({roll,config,version,ascension,onSelect,onClose}:{roll:Roll;config:any;version:string;ascension:number;onSelect:(age:number,type:number,idx:number)=>void;onClose:()=>void}){
    const [age,setAge]=useState(config.items[roll.age]?roll.age:0),[type,setType]=useState(roll.type),[query,setQuery]=useState('');const artwork=usePredictorArtwork(version);
    useEffect(()=>{const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',escape);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',escape);previous?.focus();};},[onClose]);
    const indices=useMemo(()=>((config.items[age]??[]).find((g:any)=>g.type===type)?.indices??[]).filter((idx:number)=>String(config.names[`${age}:${type}:${idx}`]).toLowerCase().includes(query.toLowerCase())),[age,type,query,config]);
    return createPortal(<div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3" onClick={onClose}>
        <section role="dialog" aria-modal="true" aria-labelledby="predictor-picker-title" className="bg-bg-secondary border border-border rounded-2xl w-full max-w-4xl max-h-[90dvh] flex flex-col shadow-2xl" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Tab'){const nodes=e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]');const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}}>
            <header className="flex items-center justify-between p-4 border-b border-border"><h2 id="predictor-picker-title" className="text-lg font-bold">Select forged item</h2><button aria-label="Close item picker" onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg"><X size={20}/></button></header>
            <div className="p-4 space-y-3 border-b border-border"><div className="flex gap-2 overflow-x-auto pb-2">{config.ageNames.map((name:string,a:number)=><button key={a} disabled={(config.ageUnlockAscension?.[a]??0)>ascension} onClick={()=>setAge(a)} className={`px-3 py-2 shrink-0 text-xs rounded-lg border disabled:opacity-30 ${a===age?'border-accent-primary text-accent-primary bg-accent-primary/10':'border-border text-text-secondary'}`} title={(config.ageUnlockAscension?.[a]??0)>ascension?'Requires ascension '+config.ageUnlockAscension[a]:name}>{name}</button>)}</div>
            <div className="grid grid-cols-2 gap-3"><label className="text-xs text-text-secondary">Equipment<select aria-label="Picker equipment type" value={type} onChange={e=>setType(Number(e.target.value))} className="w-full mt-1 bg-bg-input border border-border rounded-lg p-2">{SLOTS.map((name,t)=><option key={t} value={t}>{name}</option>)}</select></label><label className="text-xs text-text-secondary">Find item<div className="flex gap-2 items-center bg-bg-input border border-border rounded-lg px-2 mt-1"><Search size={16}/><input autoFocus aria-label="Find forged item" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by item name" className="w-full bg-transparent py-2 outline-none"/></div></label></div></div>
            <div className="p-4 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{indices.map((idx:number)=>{const name=config.names[`${age}:${type}:${idx}`];return <div key={idx} role="button" tabIndex={0} aria-label={`Select ${name}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(age,type,idx);}}}><ItemSelectionCard item={{age,idx,type}} slotKey={SLOTS[type]} slotLabel={SLOTS[type]} itemName={name} itemImage={artwork(age,type,idx,config)} isSelected={age===roll.age&&type===roll.type&&String(idx)===String(roll.idx)} onClick={()=>onSelect(age,type,idx)} artClassName="w-24 h-24"/></div>;})}{!indices.length&&<p className="text-sm text-text-muted col-span-full">No matching items.</p>}</div>
            <p className="p-3 text-xs text-text-muted border-t border-border">Choose the item you actually forged. If its name is unknown, close this picker and leave “Any item” selected.</p>
        </section>
    </div>,document.body);
}
