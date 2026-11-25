function fastFutureIterator(startSeed,job){
 const rotations=traceCandidate(BigInt(startSeed),job);if(!rotations)throw Error('The recovered seed no longer matches the entered results.');
 const current=BigInt(seedTimeline(startSeed,job.observations.length).nextSeed),initial=split64((current*MA+MB)&MASK64),increment=split64(MA),step={al:increment.lo,ah:increment.hi,...(()=>{const c=split64(MC);return{bl:c.lo,bh:c.hi};})()};let initialLo=initial.lo,initialHi=initial.hi,offset=0;
 const intervals=Array.from({length:AGES.length},(_,age)=>ageIntervals(age,job.forgeLevel));
 return{currentSeed:String(current),next(target){
  if(offset>=Number.MAX_SAFE_INTEGER)throw Error('The scan reached JavaScript’s exact roll-number limit.');
  let lo=initialLo,hi=initialHi;const uint=()=>{const raw=outputWords(lo,hi),next=stateForLow(lo,{...step,bl:0,bh:0});const sum=next.lo+step.bl;lo=sum>>>0;hi=(next.hi+Math.imul(hi,step.al)+step.bh+(sum>=Q?1:0))>>>0;return raw;};
  const raw=uint();let age=0;for(let a=0;a<AGES.length;a++)if(inside(raw,intervals[a])){age=a;break;}
  const groups=PRED_CONFIG.items[age];let type;for(let i=0;i<groups.length;i++)if((uint()>>>1)%(i+1)===0)type=groups[i].type;
  for(let i=0;i<4;i++)uint();const pick=uint();uint();
  const draw={age,type,pick,statState:(BigInt(hi)<<32n)|BigInt(lo)},key=age+':'+type;
  offset++;const sum=initialLo+increment.lo;initialLo=sum>>>0;initialHi=(initialHi+increment.hi+(sum>=Q?1:0))>>>0;
  if(!targetDrawMatches(draw,target)){rotations[key]=rotate(draw,rotations[key],null);return null;}
  const projected=projectFutureDraw(draw,rotations[key]);rotations[key]=projected.nextMasks;const match=targetMatch(projected.row,target);if(!match.matches)return null;
  return{...projected.row,seed:String(BigInt.asUintN(64,current+BigInt(offset-1))),roll:offset,forgesBefore:offset-1,possibleMatch:match.possible,matchingVariants:match.matchingVariants};
 }};
}
async function scanFuture(data){
 const target=prepareTarget(data.target),mode=data.mode==='hunt'?'hunt':'range',count=mode==='hunt'?Number.MAX_SAFE_INTEGER:integer(Number(data.count),1,Number.MAX_SAFE_INTEGER,'Future roll count'),wanted=integer(Number(data.wanted??1),1,1000,'Matches to find'),iterator=fastFutureIterator(data.startSeed,data.job),rows=[],started=performance.now();let scanned=0,matches=0,last=started;
 const snapshot=kind=>({kind,rows,currentSeed:iterator.currentSeed,scanned,matches,mode,target,total:mode==='hunt'?null:count,elapsed:performance.now()-started,storedLimit:1000});
 const impossible=impossibleTarget(data.job,target);if(impossible)return{...snapshot('scan-done'),reason:impossible};
 while(scanned<count){const row=iterator.next(target);scanned++;if(row){matches++;if(rows.length<1000)rows.push(row);if(mode==='hunt'&&matches>=wanted)break;}
  if(scanned%2048===0){if(performance.now()-last>200){postMessage(snapshot('scan-progress'));last=performance.now();}await new Promise(resolve=>setTimeout(resolve,0));}
 }
 return{...snapshot('scan-done'),reason:mode==='hunt'?'Requested matches found.':'Requested scan complete.'};
}
