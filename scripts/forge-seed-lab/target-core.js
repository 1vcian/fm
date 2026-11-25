function prepareTarget(input={}){
 const target={minAge:input.minAge===''||input.minAge==null?null:integer(Number(input.minAge),0,AGES.length-1,'Minimum age'),type:input.type===''||input.type==null?null:integer(Number(input.type),0,7,'Equipment type'),query:String(input.query??'').trim().toLowerCase(),stat:input.stat===''||input.stat==null?null:integer(Number(input.stat),0,12,'Target substat'),percent:Number(input.percent??0),comparison:input.comparison==='gte'?'gte':'gt',certainty:input.certainty==='possible'?'possible':'all'};
 if(!Number.isFinite(target.percent)||target.percent<0||target.percent>100)throw Error('Target percentage must be between 0 and 100.');
 if(target.stat!=null&&!PRED_CONFIG.rollable.includes(target.stat))throw Error('Target substat is not rollable.');
 return target;
}
function targetDrawMatches(draw,target){return(target.minAge==null||draw.age>=target.minAge)&&(target.type==null||draw.type===target.type);}
function targetVariantMatches(row,variant,target){
 if(target.query&&!(`${AGES[row.age]} ${TYPES[row.type]} ${variant.name}`).toLowerCase().includes(target.query))return false;
 if(target.stat==null)return true;
 const stat=variant.stats.find(s=>s.k===target.stat);if(!stat)return false;
 const percent=Number(stat.percent.toFixed(2));return target.comparison==='gte'?percent>=target.percent:percent>target.percent;
}
function targetMatch(row,target){const matching=row.variants.filter(v=>targetVariantMatches(row,v,target));return{matches:matching.length>0&&(target.certainty==='possible'||matching.length===row.variants.length),possible:matching.length<row.variants.length,matchingVariants:matching.map(v=>v.idx)};}
function impossibleTarget(job,target){
 for(let age=0;age<AGES.length;age++){
  if(target.minAge!=null&&age<target.minAge||!ageIntervals(age,job.forgeLevel).length)continue;
  if(target.stat!=null){if(!PRED_CONFIG.statCounts[age])continue;const maximum=Number((PRED_CONFIG.statRanges[target.stat].upper*100).toFixed(2));if(target.comparison==='gte'?maximum<target.percent:maximum<=target.percent)continue;}
  for(const group of PRED_CONFIG.items[age]){if(target.type!=null&&group.type!==target.type)continue;for(const idx of group.indices){if(target.stat!=null&&group.type===5&&target.stat===(PRED_CONFIG.weapons[age+':'+idx]?7:8))continue;const text=`${AGES[age]} ${TYPES[group.type]} ${PRED_CONFIG.names[age+':'+group.type+':'+idx]}`.toLowerCase();if(!target.query||text.includes(target.query))return null;}}
 }
 return 'This target cannot occur at the current forge level under the bundled item tables. Check the age, slot and substat threshold.';
}
