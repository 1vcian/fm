const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c=vm.createContext({console,structuredClone,performance});
for(const file of ['engine.js','lab-core.js','worker.js','target-core.js','scan-worker.js'])vm.runInContext(fs.readFileSync(__dirname+'/../'+file,'utf8'),c);
vm.runInContext(`
applyModel({version:'2026_11_16_09_55',ascension:0});
if(AGES.length!==13||modelForgeCap()!==35)throw Error('Latest caps');
if(PRED_CONFIG.ageUnlockAscension.slice(10).some(x=>x!==3))throw Error('Age gates');
if(PRED_CONFIG.statCounts[0]!==0)throw Error('Unascended stats');
applyModel({version:'2026_11_16_09_55',ascension:1});
if(PRED_CONFIG.statCounts[0]!==2||modelForgeCap()!==35)throw Error('Ascended stats');
applyModel({version:'2026_11_16_09_55',ascension:3});
if(modelForgeCap()!==50||PRED_CONFIG.primaryMultipliers[3]!==125000)throw Error('Ascension 3');
const start=83223451347884232n, raw={model:modelIdentity(),level:50,method:'bonuses',observations:[]};
for(let i=0;i<12;i++){const d=drawVisible(start+BigInt(i),49),idx=PRED_CONFIG.items[d.age].find(g=>g.type===d.type).indices[0];raw.observations.push({age:d.age,type:d.type,idx:'',stats:statsFor(d,idx).map(s=>({k:s.k,percent:s.percent.toFixed(2)}))});}
const job=makeJob(raw),it=fastFutureIterator(start,job),target=prepareTarget({});
for(let i=0;i<5000;i++){const fast=it.next(target),d=drawVisible(start+12n+BigInt(i),49);if(fast.age!==d.age||fast.type!==d.type)throw Error('Latest fast mismatch');}
`,c);
console.log('PASS: current game data, ascension gates, and future roll forecasts');
