function ageLabel(age){const unlock=PRED_CONFIG.ageUnlockAscension?.[age]??0;return AGES[age]+(unlock>activeModel.ascension?' · Ascension '+unlock:'');}
function rollSummary(o,index){if(o.skip)return '#'+(index+1)+' · Unknown roll';const name=o.idx!==''&&o.idx!=null?PRED_CONFIG.names[o.age+':'+o.type+':'+o.idx]:TYPES[o.type],stats=(o.stats??[]).filter(s=>s.k!==''&&s.k!=null&&String(s.percent??'').trim()).map(s=>STATS[s.k]+' '+s.percent+'%');return '#'+(index+1)+' · '+(AGES[o.age]??'Unknown age')+' · '+(name??TYPES[o.type])+(stats.length?' · '+stats.join(', '):'');}
function refreshRollSummaries(){const items=collect();document.querySelectorAll('.roll-card').forEach((el,i)=>{const label=el.querySelector('.roll-summary-label');if(label)label.textContent=rollSummary(items[i],i);});const counter=$('roll-tree-count');if(counter)counter.textContent=items.length+' rolls';}
function syncModelUI(){
 $('model-version').innerHTML=Object.entries(MODEL_CONFIGS).map(([key,c])=>'<option value="'+key+'">'+(key==='legacy211'?'Legacy · 2.11.1':'Latest · 16 Nov 2026')+'</option>').join('');$('model-version').value=activeModel.version;
 $('ascension').innerHTML=options(PRED_CONFIG.primaryMultipliers.map((_,a)=>[a,String(a)]),activeModel.ascension);$('level').max=String(modelForgeCap());if(Number($('level').value)>modelForgeCap())$('level').value=String(modelForgeCap());
 $('config-version').textContent=PRED_CONFIG.version;$('model-notes').textContent='Forge cap '+modelForgeCap()+' · Equipment damage/health ×'+PRED_CONFIG.primaryMultipliers[activeModel.ascension].toLocaleString()+' · '+(activeModel.ascension?'Every item rolls '+PRED_CONFIG.ascendedStatCount+' substats.':'Substats depend on item age.')+' Keep all observations in one configuration and ascension; do not mix results from before and after ascending.';
 const previous=$('future-age').value;$('future-age').innerHTML='<option value="">Any age</option>'+options(AGES.map((_,i)=>[i,ageLabel(i)+' or higher']),previous);if(!$('future-age').value)$('future-age').value='';
 $('age-colors').textContent=(PRED_CONFIG.ageColors??[]).map((color,i)=>'.age-'+i+'{background:'+color+'25;color:'+color+'}').join('');
}
function selectView(name){if(!['recovery','predictions','hammers','help'].includes(name))name='recovery';document.querySelectorAll('.page-view').forEach(el=>el.hidden=el.dataset.view!==name);document.querySelectorAll('[data-open-view]').forEach(el=>{el.classList.toggle('active',el.dataset.openView===name);el.setAttribute('aria-current',el.dataset.openView===name?'page':'false');});try{localStorage.setItem('forge-seed-lab-view',name);}catch{}document.documentElement.scrollTop=0;document.body.scrollTop=0;}
for(const id of ['model-version','ascension'])$(id).onchange=()=>{rows=collect();applyModel({version:$('model-version').value,ascension:Number($('ascension').value)});syncModelUI();renderRows();invalidate();};
document.querySelectorAll('[data-open-view]').forEach(el=>el.onclick=()=>selectView(el.dataset.openView));
$('collapse-rolls').onclick=()=>{document.querySelectorAll('.roll-card').forEach(el=>el.open=false);};
$('expand-rolls').onclick=()=>{document.querySelectorAll('.roll-card').forEach(el=>el.open=true);$('roll-tree').open=true;};
syncModelUI();
let savedView='recovery';try{savedView=localStorage.getItem('forge-seed-lab-view')??savedView;}catch{}selectView(savedView);
