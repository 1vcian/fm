import configs from '../../../scripts/forge-seed-lab/model-data.json';
import { getStatName } from '../../utils/statNames';

export const MODELS = configs as Record<string, any>;
export const LATEST = '2026_11_16_09_55';
export const SLOTS = ['Helmet','Armour','Gloves','Necklace','Ring','Weapon','Shoes','Belt'];
export const STAT_IDS = ['CriticalChance','CriticalMulti','BlockChance','HealthRegen','LifeSteal','DoubleDamageChance','DamageMulti','MeleeDamageMulti','RangedDamageMulti','AttackSpeed','SkillDamageMulti','SkillCooldownMulti','HealthMulti'];
export type Bonus = { k: string | number; percent: string };
export type Roll = { age:number; type:number; idx:string|number; displayLevel?:string|number; skip?:boolean; stats:Bonus[] };
export type Inputs = {schemaVersion:1; model:{version:string;ascension:number};forgeLevel:string|number;method:string;autoSearch:boolean;observations:Roll[];searchSeconds?:number};
export const STORAGE = 'forge-seed-lab-input';
export const blankRoll = (age=8,type=6):Roll => ({age,type,idx:'',displayLevel:'',stats:[]});
export const statName = (k:number|string) => getStatName(STAT_IDS[Number(k)]??'');
export const statCount = (config:any,ascension:number,age:number):number => ascension>0?config.ascendedStatCount:config.statCounts[age];
export function restoreInputs(forgeLevel=1,ascension=0):Inputs {
    const fallback:Inputs={schemaVersion:1,model:{version:LATEST,ascension},forgeLevel,method:'auto',autoSearch:true,observations:[blankRoll()]};
    try{const saved=JSON.parse(localStorage.getItem(STORAGE)??'null');if(!saved)return fallback;return normalizeInputs(saved);}catch{return fallback;}
}
export function normalizeInputs(data:any):Inputs {
    const model=data.model??{version:'legacy211',ascension:0},config=MODELS[model.version];
    if(!config||!Number.isInteger(model.ascension)||model.ascension<0||model.ascension>=config.primaryMultipliers.length)throw Error('Select a supported data version and forge ascension.');
    if(!Array.isArray(data.observations)||data.observations.length<1||data.observations.length>100)throw Error('Input files must contain 1 to 100 rolls.');
    const forgeLevel=Number(data.forgeLevel??data.level);
    if(!Number.isInteger(forgeLevel)||forgeLevel<1||forgeLevel>config.maxDisplayedByAscension[model.ascension])throw Error('Forge level is outside the selected ascension cap.');
    const observations=data.observations.map((o:any)=>{
        if(o.skip)return {...blankRoll(),skip:true};
        if(!Number.isInteger(o.age)||!config.items[o.age]||!Number.isInteger(o.type)||o.type<0||o.type>7||!Array.isArray(o.stats??[]))throw Error('Invalid item observation.');
        return {age:o.age,type:o.type,idx:o.idx??'',displayLevel:o.displayLevel??'',stats:(o.stats??[]).map((s:any)=>({k:s.k??'',percent:String(s.percent??'')}))};
    });
    return {schemaVersion:1,model,forgeLevel,method:'auto',autoSearch:data.autoSearch!==false,observations,searchSeconds:300};
}
export function readiness(input:Inputs){
    const config=MODELS[input.model.version];let complete=0,unfinished=false;
    for(const roll of input.observations){if(roll.skip)continue;const stats=roll.stats.filter(s=>String(s.k)!==''&&/^\d+(?:[.,]\d{1,4})?$/.test(String(s.percent).replace(/^-/,'').trim()));const count=statCount(config,input.model.ascension,roll.age);const ready=stats.length>0&&stats.length===count||String(roll.displayLevel??'').trim()!==''||count===0&&String(roll.idx)!=='';if(ready)complete++;else unfinished=true;}
    return {complete,unfinished};
}
export function bonusOptions(config:any,roll:Roll,index:number){
    const chosen=roll.stats[index]?.k??'';const ranged=roll.type===5&&String(roll.idx)!==''?config.weapons[roll.age+':'+roll.idx]:null;
    return [{id:'',name:'Choose substat'},...STAT_IDS.map((_,k)=>({id:String(k),name:statName(k),disabled:!config.rollable.includes(k)||(k!==Number(chosen)&&roll.stats.some((s,j)=>j!==index&&String(s.k)===String(k)))||((k===7||k===8)&&roll.stats.some((s,j)=>j!==index&&Number(s.k)===(k===7?8:7)))||(ranged!=null&&k===(ranged?7:8))}))];
}
export function downloadJson(name:string,data:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function timeLabel(roll:number,seconds:string){const n=Number(seconds);if(!seconds||!Number.isFinite(n)||n<=0)return 'Not set';let total=Math.ceil(roll*n);if(!Number.isSafeInteger(total))return 'Out of range';const days=Math.floor(total/86400);total%=86400;const hours=Math.floor(total/3600),minutes=Math.ceil(total%3600/60);return [days?days+'d':'',hours?hours+'h':'',minutes?minutes+'m':''].filter(Boolean).join(' ')||'<1m';}
