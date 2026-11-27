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
