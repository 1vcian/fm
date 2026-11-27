const MODEL_CONFIGS=@@MODEL_DATA@@;
const DEFAULT_MODEL={version:'2026_11_16_09_55',ascension:0};
let activeModel={version:'legacy211',ascension:0};
function applyModel(selection){
 const version=selection?.version??'legacy211',base=MODEL_CONFIGS[version];if(!base)throw Error('Unknown game data version.');
 const ascension=Number(selection?.ascension??0);if(!Number.isInteger(ascension)||ascension<0||ascension>=base.primaryMultipliers.length)throw Error('Invalid forge ascension.');
 activeModel={version,ascension};PRED_CONFIG=JSON.parse(JSON.stringify(base));AGES=PRED_CONFIG.ageNames.slice();PRED_CONFIG.ascension=ascension;
 if(ascension>0)for(const age of Object.keys(PRED_CONFIG.statCounts))PRED_CONFIG.statCounts[age]=PRED_CONFIG.ascendedStatCount;
 return{...activeModel};
}
function modelForgeCap(){return PRED_CONFIG.maxDisplayedByAscension[activeModel.ascension];}
function modelIdentity(){return{...activeModel};}
