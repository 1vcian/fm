const fs=require('fs'),vm=require('vm'),{Worker}=require('node:worker_threads'),assert=require('node:assert/strict');
const root=__dirname+'/..',source=fs.readFileSync(root+'/engine.js','utf8')+'\n'+fs.readFileSync(root+'/lab-core.js','utf8')+'\n'+fs.readFileSync(root+'/worker.js','utf8');
const c=vm.createContext({structuredClone});vm.runInContext(fs.readFileSync(root+'/engine.js','utf8')+'\n'+fs.readFileSync(root+'/lab-core.js','utf8')+'\nglobalThis.api={makeJob};',c);
const observed=JSON.parse(fs.readFileSync(__dirname+'/observed.json'));
const job=c.api.makeJob({level:observed.forgeLevel,observations:observed.observations});
assert(!('start'in job)&&!('end'in job));
const worker=new Worker("const {parentPort}=require('node:worker_threads');globalThis.postMessage=m=>parentPort.postMessage(m);parentPort.on('message',data=>onmessage({data}));\n"+source,{eval:true});
worker.on('message',r=>{if(r.kind==='progress'){if(Math.random()<.05)console.log(r.phase,r.hypotheses,r.lowChecked);return;}if(r.kind==='error'){console.error(r);worker.terminate();process.exitCode=1;return;}
// Ground truth is introduced only after the recovery worker has returned.
assert.equal(r.count,1);assert.equal(r.seeds[0],'42');assert.equal(r.complete,true);assert.equal(r.projections[0].next.seed,'52');console.log('PASS: global recovery without a seed or range input',r.elapsed,'ms',r.hypotheses,'output hypotheses',r.lowChecked,'remaining state values');worker.terminate();});worker.on('error',e=>{console.error(e);process.exitCode=1});worker.postMessage(job);
