import assert from 'node:assert/strict';
import { normalizeInputs, readiness, bonusOptions, MODELS } from '../../../src/components/ForgePredictor/model';
const data={forgeLevel:29,observations:Array.from({length:3},()=>({age:7,type:0,idx:'',stats:[{k:0,percent:'4.4300'},{k:1,percent:'19.40'}]}))};
const input=normalizeInputs(data);assert.equal(input.model.version,'legacy211');assert.equal(input.observations[0].stats[0].percent,'4.4300');assert.equal(input.method,'auto');assert.equal(readiness(input).complete,3);
const options=bonusOptions(MODELS.legacy211,input.observations[0],1);assert(options.find(o=>o.id==='0')?.disabled);assert.equal(options.find(o=>o.id==='6')?.disabled,false);
const weapon={age:7,type:5,idx:0,stats:[]};const ranged=MODELS.legacy211.weapons['7:0'];assert(bonusOptions(MODELS.legacy211,weapon,0).find(o=>o.id===String(ranged?7:8))?.disabled);
assert.throws(()=>normalizeInputs({...data,forgeLevel:36}),/Forge level/);assert.equal(normalizeInputs({...data,model:{version:'2026_11_16_09_55',ascension:3},forgeLevel:50}).forgeLevel,50);
assert.equal(readiness({...input,observations:[...input.observations,{age:8,type:0,idx:'',stats:[]}]}).unfinished,true);
console.log('PASS: precision-preserving imports, legacy migration, canonical stat eligibility, weapon restrictions and readiness');
