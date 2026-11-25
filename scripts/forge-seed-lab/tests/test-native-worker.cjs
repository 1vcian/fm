const fs=require('node:fs'),{Worker}=require('node:worker_threads'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../../../public/forge-seed-lab/predictor-worker.js','utf8');
function request(data,final){return new Promise((resolve,reject)=>{const w=new Worker("const {parentPort}=require('node:worker_threads');globalThis.postMessage=data=>parentPort.postMessage(data);parentPort.on('message',data=>onmessage({data}));\n"+source,{eval:true});const timer=setTimeout(()=>{w.terminate();reject(Error('Timeout'));},30000);w.on('error',reject);w.on('message',r=>{if(r.kind===final||r.kind==='error'){clearTimeout(timer);w.terminate();resolve(r);}});w.postMessage(data);});}
(async()=>{
 const fixture=JSON.parse(fs.readFileSync(__dirname+'/../example.json')),input={schemaVersion:1,model:{version:'legacy211',ascension:0},forgeLevel:fixture.forgeLevel,method:'auto',observations:fixture.observations};
 const result=await request({kind:'recover',input},'done');assert.equal(result.complete,true);assert.equal(result.count,1);assert.equal(result.seeds[0],'42');assert.equal(result.projections[0].next.seed,'52');
 const invalid=structuredClone(input);invalid.searchSeconds=0;assert.match((await request({kind:'validate',input:invalid},'validated')).message,/Search seconds/);
 const comma=structuredClone(input);comma.observations[0].stats[0].percent=comma.observations[0].stats[0].percent.replace('.',',');const normalized=await request({kind:'validate',input:comma},'validated');assert.equal(normalized.kind,'validated');assert.equal(normalized.input.observations[0].stats[0].percent,input.observations[0].stats[0].percent);
 const scan=await request({kind:'scan',startSeed:'42',job:{forgeLevel:28,observations:[],model:input.model},mode:'range',count:1,wanted:1,target:{}},'scan-done');assert.equal(scan.kind,'error');
 const value=await request({kind:'hammer',model:input.model,hammers:1000,forgeLevel:29,caps:Array(8).fill(1),sellBonus:25,freeChance:20},'hammer-done');assert.equal(Math.round(value.value.mature),31250);
 console.log('PASS: native worker blind recovery, exact current seed, import validation, comma normalization and hammer calculation');
})().catch(e=>{console.error(e);process.exitCode=1});
