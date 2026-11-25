function nativeInput(input){
 applyModel(input.model??{version:'legacy211',ascension:0});
 integer(Number(input.forgeLevel??input.level),1,modelForgeCap(),'Forge level');
 if(input.searchSeconds!=null)integer(Number(input.searchSeconds),10,3600,'Search seconds');
 if(!Array.isArray(input.observations)||input.observations.length<1||input.observations.length>100)throw Error('Enter 1 to 100 rolls.');
 input.observations.forEach((o,i)=>{if(o.skip)return;try{for(const s of o.stats??[])s.percent=String(s.percent??'').replace(',','.');const prepared=prepareObservation(o);if(prepared.stats.some(s=>s.k===7)&&prepared.stats.some(s=>s.k===8))throw Error('Melee Damage and Ranged Damage cannot roll together.');if(o.type===5&&String(o.idx)!==''){const ranged=PRED_CONFIG.weapons[o.age+':'+o.idx];if(prepared.stats.some(s=>s.k===(ranged?7:8)))throw Error('This damage substat cannot roll on the selected weapon.');}if((PRED_CONFIG.ageUnlockAscension?.[o.age]??0)>activeModel.ascension)throw Error('This age is locked at the selected forge ascension.');}catch(e){throw Error('Roll #'+(i+1)+': '+e.message);}});
 return input;
}
onmessage=async({data})=>{try{
 if(data.kind==='validate'){nativeInput(data.input);postMessage({kind:'validated',input:data.input});return;}
 if(data.kind==='hammer'){applyModel(data.model);postMessage({kind:'hammer-done',value:calculateHammerValue(data.hammers,data.forgeLevel,data.caps,data.sellBonus,data.freeChance)});return;}
 if(data.kind==='scan'){applyModel(data.job.model);postMessage(await scanFuture(data));return;}
 const input=nativeInput(data.input),job=makeJob({model:input.model,level:input.forgeLevel,observations:input.observations,method:input.method});
 postMessage({kind:'ready',job});
 if(job.observations.some(o=>!o.skip&&o.stats.some(s=>{const [lo,hi]=numericIntervals(s);return lo>hi;}))){
  postMessage({kind:'done',complete:true,count:0,seeds:[],projections:[],reason:'No match in the bundled model. At least one entered substat falls outside its modeled range.'});return;
 }
 if(job.method==='levels'){importScripts('predictor-solver.js');postMessage(await recoverLevels(job,m=>postMessage(m)));}
 else postMessage(await recover(job,m=>postMessage(m)));
 }catch(e){postMessage({kind:'error',message:e.message,complete:false});}};
