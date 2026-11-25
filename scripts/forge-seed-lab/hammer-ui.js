function calculateHammerValue(hammers,forgeLevel,caps,sellBonus=0,freeChance=0){
 integer(hammers,0,Number.MAX_SAFE_INTEGER,'Hammers');integer(forgeLevel,1,modelForgeCap(),'Forge level');
 if(caps.length!==8)throw Error('Enter a maximum item level for each slot.');
 if(!Number.isFinite(sellBonus)||sellBonus<0||sellBonus>1000)throw Error('Sell bonus must be between 0% and 1000%.');
 if(!Number.isFinite(freeChance)||freeChance<0||freeChance>99)throw Error('Free-forge chance must be between 0% and 99%.');
 const brackets=HammerModel.sortBrackets(PRED_CONFIG.brackets),maxLevel=Math.max(...Object.values(PRED_CONFIG.brackets).map(b=>b.UpperRange)),slots={};
 caps.forEach((cap,t)=>{integer(cap,1,maxLevel+1,'Maximum displayed item level');slots[t]={itemType:t,key:TYPES[t],maxLevel:cap-1,sellBonus:sellBonus/100};});
 const chances=PRED_CONFIG.probabilities[forgeLevel-1];if(!chances)throw Error('Forge level is not in the bundled tables.');
 const input={brackets,ageChances:Object.fromEntries(Array.from({length:AGES.length},(_,age)=>[age,chances['Age'+age]])),typesByAge:Object.fromEntries(Object.entries(PRED_CONFIG.items).map(([age,groups])=>[age,groups.map(g=>g.type)])),slots,sell:{sellBasePrice:PRED_CONFIG.sellBasePrice,levelScalingBase:PRED_CONFIG.levelScaling},freeChance:freeChance/100};
 const fresh=HammerModel.computeForgeModel({...input,state:{kind:'sinceAscension',forges:0}},hammers),mature=HammerModel.computeForgeModel({...input,state:{kind:'atCap'}},hammers);
 return{fresh:fresh.coins,mature:mature.coins,expectedForges:mature.forges};
}
function renderHammerValue(){try{const hammers=Number($('hammer-count').value),level=Number($('level').value),caps=[...document.querySelectorAll('.hammer-cap')].map(el=>Number(el.value)),sell=Number($('hammer-sell').value),free=Number($('hammer-free').value),value=calculateHammerValue(hammers,level,caps,sell,free);$('hammer-error').textContent='';$('hammer-result').textContent=Math.round(value.fresh).toLocaleString()+' to '+Math.round(value.mature).toLocaleString()+' estimated coins';$('hammer-detail').textContent=hammers.toLocaleString()+' hammers at forge level '+level+' give approximately '+Math.round(value.expectedForges).toLocaleString()+' items with the entered free-forge chance. This is a range of expected averages from fresh to mature hidden item levels, not guaranteed minimum and maximum proceeds.';}catch(e){$('hammer-error').textContent=e.message;$('hammer-result').textContent='Check the inputs';$('hammer-detail').textContent='';}}
$('hammer-caps').innerHTML=TYPES.map((name,t)=>'<label>'+E(name)+' max item level<input class="hammer-cap" type="number" min="1" max="149" value="'+(PRED_CONFIG.baseCap+1)+'" data-slot="'+t+'"></label>').join('');
for(const id of ['hammer-count','hammer-sell','hammer-free','hammer-caps'])$(id).addEventListener('input',renderHammerValue);
$('level').addEventListener('input',renderHammerValue);
window.ForgeSeedLab.calculateHammerValue=calculateHammerValue;
renderHammerValue();
