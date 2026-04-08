import { AGES } from './constants';

export const ITEM_ASSETS = [
    // Primitive
    "IconPrimitiveWeaponAxe.png",
    "IconPrimitiveWeaponBlowgun.png",
    "IconPrimitiveWeaponBone.png",
    "IconPrimitiveWeaponBranch.png",
    "IconPrimitiveWeaponClub.png",
    "IconPrimitiveWeaponRock.png",
    "IconPrimitiveWeaponSlinger.png",
    "IconPrimitiveArmorBearskin.png",
    "IconPrimitiveArmorHide.png",
    "IconPrimitiveBeltBoneskirt.png",
    "IconPrimitiveBeltWaisttie.png",
    "IconPrimitiveFootIvoryshin.png",
    "IconPrimitiveFootWraps.png",
    "IconPrimitiveGloveBark.png",
    "IconPrimitiveGloveBearpaw.png",
    "IconPrimitiveHeadgearBeard.png",
    "IconPrimitiveHeadgearMask.png",
    "IconPrimitiveHeadgearPaint.png",
    "IconPrimitiveHeadgearSkull.png",
    "IconPrimitiveNeckShamantalisman.png",
    "IconPrimitiveNeckToothnecklace.png",
    "IconPrimitiveRingShardring.png",
    "IconPrimitiveRingSkullring.png",

    // Medieval
    "IconMedievalWeaponBow.png",
    "IconMedievalWeaponKatana.png",
    "IconMedievalWeaponScythe.png",
    "IconMedievalWeaponSpearandshield.png", // Verify sort order for 'Spear...' vs 'Sword...'
    "IconMedievalWeaponSwordandshield.png",
    "IconMedievalWeaponTomahawk.png",
    "IconMedievalWeaponWarhammer.png",
    "IconMedievalArmorIronplates.png",
    "IconMedievalArmorQuirass.png",
    "IconMedievalBeltBeltofbaltazar.png",
    "IconMedievalBeltBeltpouch.png",
    "IconMedievalFootSandals.png",
    "IconMedievalFootSpurredstomper.png",
    "IconMedievalGloveGauntlet.png",
    "IconMedievalGloveIronfist.png",
    "IconMedievalHeadgearDeathshat.png",
    "IconMedievalHeadgearGreekhelmet.png",
    "IconMedievalHeadgearKnighthelmet.png",
    "IconMedievalHeadgearRomanhelmet.png",
    "IconMedievalHeadgearSamuraihelmet.png",
    "IconMedievalNeckLuckycharm.png",
    "IconMedievalNeckValorsigil.png",
    "IconMedievalRingBlessedgem.png",
    "IconMedievalRingIronring.png",

    // EarlyModern
    "IconEarlymodernWeaponCrossbow.png",
    "IconEarlymodernWeaponDualpistols.png",
    "IconEarlymodernWeaponExecutioner.png",
    "IconEarlymodernWeaponMusket.png",
    "IconEarlymodernWeaponPiratessword.png",
    "IconEarlymodernWeaponRapier.png",
    "IconEarlymodernArmorArmorskirt.png",
    "IconEarlymodernArmorCavalrycardigan.png",
    "IconEarlymodernBeltHaroldsharness.png",
    "IconEarlymodernBeltLeatherbelt.png",
    "IconEarlymodernFootLeatherboots.png",
    "IconEarlymodernlFootRidingboots.png", // Note: typo in filename 'lFoot'
    "IconEarlymodernGloveFencermitts.png",
    "IconEarlymodernGloveLeathergloves.png",
    "IconEarlymodernHeadgearBattlehelmet.png",
    "IconEarlymodernHeadgearCaptainshat.png",
    "IconEarlymodernHeadgearFeatherhat.png",
    "IconEarlymodernHeadgearSlavichat.png",
    "IconEarlymodernHeadgearTophat.png",
    "IconEarlymodernNeckClock.png",
    "IconEarlymodernNeckTreasurekey.png",
    "IconEarlymodernRingEmeraldeye.png",
    "IconEarlymodernRingTrinityband.png",

    // Modern
    "IconModernWeaponAk.png",
    "IconModernWeaponBaton.png",
    "IconModernWeaponKnuckledusters.png",
    "IconModernWeaponM4.png",
    "IconModernWeaponRiotshield.png",
    "IconModernWeaponSniper.png",
    "IconModernWeaponUzi.png",
    "IconModernWeaponWrench.png",
    "IconModernArmorCamouflage.png",
    "IconModernArmorKevlar.png",
    "IconModernBeltAmmopouch.png",
    "IconModernBeltTacticalbelt.png",
    "IconModernFootVeteranboots.png",
    "IconModernlFootCombatboots.png", // Note: typo 'lFoot'
    "IconModernGloveCombatgloves.png",
    "IconModernGloveTacticalhalffingers.png",
    "IconModernHeadgearFedorahat.png",
    "IconModernHeadgearKevlarhelmet.png",
    "IconModernHeadgearOfficershat.png",
    "IconModernHeadgearRiothelmet.png",
    "IconModernHeadgearSergeanthat.png",
    "IconModernHeadgearSteelhelmet.png",
    "IconModernHeadgearWinterhat.png",
    "IconModernNeckDogtags.png",
    "IconModernNeckFortunenecklace.png",
    "IconModernRingBolt.png",
    "IconModernRingBrotherhoodring.png",

    // Space
    "IconSpaceWeaponBlaster.png",
    "IconSpaceWeaponRobotsword.png",
    "IconSpaceWeaponSaber.png",
    "IconSpaceWeaponSpacegun.png",
    "IconSpaceWeaponSpacepistol.png",
    "IconSpaceArmorExoskeleton.png",
    "IconSpaceArmorSpacesuit.png",
    "IconSpaceBeltAnabiosisstraps.png",
    "IconSpaceBeltSupportcorset.png",
    "IconSpaceFootFeetthrusters.png",
    "IconSpaceFootSpaceshoes.png",
    "IconSpaceGloveRemote.png",
    "IconSpaceGloveSpacegloves.png",
    "IconSpaceHeadgearBiohelmet.png",
    "IconSpaceHeadgearGasmask.png",
    "IconSpaceHeadgearIronmech.png",
    "IconSpaceHeadgearSpacehelmet.png",
    "IconSpaceNeckKuipernecklace.png",
    "IconSpaceNeckPulsarpendant.png",
    "IconSpaceRingIcarusring.png",
    "IconSpaceRingSolariusring.png",

    // Interstellar
    "IconInterstellarWeaponDualwieldmelee.png",
    "IconInterstellarWeaponIonicblaster.png",
    "IconInterstellarWeaponIsobariccutter.png",
    "IconInterstellarWeaponLightswordandshield.png",
    "IconInterstellarWeaponPlasmarifle.png",
    "IconInterstellarWeaponRaygun.png",
    "IconInterstellarArmorAdamantiumsuit.png",
    "IconInterstellarArmorPlasmasuit.png",
    "IconInterstellarBeltPelvicsynchronizer.png",
    "IconInterstellarBeltSpinalstabilizer.png",
    "IconInterstellarFootHydraulicfeet.png",
    "IconInterstellarFootRobofeet.png",
    "IconInterstellarGloveManualimpactors.png",
    "IconInterstellarGlovePalmimplants.png",
    "IconInterstellarHeadgearAdvancedmech.png",
    "IconInterstellarHeadgearAlienhead.png",
    "IconInterstellarHeadgearDestroyermask.png",
    "IconInterstellarHeadgearHeavyduty.png",
    "IconInterstellarHeadgearRobohelm.png",
    "IconInterstellarHeadgearStellariumhelm.png",
    "IconInterstellarNeckGammaartifactscollar.png",
    "IconInterstellarNeckPsichoker.png",
    "IconInterstellarRingEclipsering.png",
    "IconInterstellarRingRariumring.png",

    // Multiverse
    "IconMultiverseWeaponHolographictrident.png",
    "IconMultiverseWeaponMentalspear.png",
    "IconMultiverseWeaponProjectedcutlass.png",
    "IconMultiverseWeaponSimulatedbow.png",
    "IconMultiverseWeaponVirtualgun.png",
    "IconMultiverseWeaponVirtualsword.png",
    "IconMultiverseArmorHoloarmor.png",
    "IconMultiverseArmorSpectralplates.png",
    "IconMultiverseBeltOrbitbelt.png",
    "IconMultiverseBeltRealitybelt.png",
    "IconMultiverseFootEtherealsocks.png",
    "IconMultiverseFootFasttravelshoes.png",
    "IconMultiverseGloveImpulsecontroller.png",
    "IconMultiverseGloveRainbowgloves.png",
    "IconMultiverseHeadgearFirewallmask.png",
    "IconMultiverseHeadgearSpeedrunnercasquette.png",
    "IconMultiverseHeadgearStalkerhelm.png",
    "IconMultiverseHeadgearVirtualhelmet.png",
    "IconMultiverseNeckCrystallamulet.png",
    "IconMultiverseNeckGlitchnecklace.png",
    "IconMultiverseRingConnectionring.png",
    "IconMultiverseRingMobeusring.png",

    // Quantum
    "IconQuantumWeaponBlackbow.png",
    "IconQuantumWeaponBlackgun.png",
    "IconQuantumWeaponBlackhammer.png",
    "IconQuantumWeaponBlackspear.png",
    "IconQuantumWeaponBlackswordandshield.png",
    "IconQuantumWeaponQuantumstaff.png",
    "IconQuantumArmorDeltaarmor.png",
    "IconQuantumArmorOrbitersuit.png",
    "IconQuantumBeltNeutrinobelt.png",
    "IconQuantumBeltUncertaintybelt.png",
    "IconQuantumFootAntimatterfeet.png",
    "IconQuantumFootAntiravityboots.png",
    "IconQuantumGloveGravitygloves.png",
    "IconQuantumGloveNeutronfingerprints.png",
    "IconQuantumHeadgearEnergyhelmet.png",
    "IconQuantumHeadgearEntanglementhelm.png",
    "IconQuantumHeadgearHairbandana.png",
    "IconQuantumHeadgearHairtied.png",
    "IconQuantumHeadgearSubfrequencymask.png",
    "IconQuantumNeckHiggsnecklace.png",
    "IconQuantumNeckVoidnecklace.png",
    "IconQuantumRingAuraring.png",
    "IconQuantumRingProbabilityring.png",

    // Underworld
    "IconUnderworldWeaponAbyssalFork.png",
    "IconUnderworldWeaponDoomMace.png",
    "IconUnderworldWeaponInfernalTrident.png",
    "IconUnderworldWeaponShadowScimitar.png",
    "IconUnderworldWeaponSoulpiercer.png",
    "IconUnderworldArmorCape.png",
    "IconUnderworldArmorDoomplate.png",
    "IconUnderworldArmorMoltenPlates.png", // Capitalized
    "IconUnderworldBeltCircleofPain.png",
    "IconUnderworldBeltCrimsonBelt.png",
    "IconUnderworldFootDreadsteps.png",
    "IconUnderworldFootGreaves.png",
    "IconUnderworldGloveGripofTorment.png",
    "IconUnderworldGloveVoidClaw.png",
    "IconUnderworldHeadgearHellforgedHelm.png",
    "IconUnderworldHeadgearRotfangVisor.png",
    "IconUnderworldHeadgearSpiteCrown.png",
    "IconUnderworldHeadgearVenomCrest.png",
    "IconUnderworldNeckSpiteCollar.png",
    "IconUnderworldNeckThornNecklace.png",
    "IconUnderworldRingPrismRing.png",
    "IconUnderworldRingSkullbinder.png",

    // Divine
    "IconDivineWeaponAngelicpitchfork.png",
    "IconDivineWeaponDragondagger.png",
    "IconDivineWeaponSerpentsword.png",
    "IconDivineWeaponSirenssong.png",
    "IconDivineWeaponStaff.png",
    "IconDivineWeaponStaffofwisdom.png",
    "IconDivineArmorHolygown.png",
    "IconDivineArmorPaladinarmor.png",
    "IconDivineBeltSanctitybelt.png",
    "IconDivineBeltSorcererbelt.png",
    "IconDivineFootCelestialtreaders.png",
    "IconDivineFootMercurysandals.png",
    "IconDivineGloveEnchantergloves.png",
    "IconDivineGloveWorshipergloves.png",
    "IconDivineHeadgearCelticoverhead.png",
    "IconDivineHeadgearProtectivehalo.png",
    "IconDivineHeadgearSerpentwreath.png",
    "IconDivineHeadgearWhitehair.png",
    "IconDivineHeadgearWizardshat.png",
    "IconDivineNeckTalonnecklace.png",
    "IconDivineNeckThoramulet.png",
    "IconDivineRingDivinityring.png",
    "IconDivineRingNazarring.png",
];

export const getAssetPath = (filename: string) => `${import.meta.env.BASE_URL}Texture2D/${filename}`;

/**
 * Weapon image order mapping per age (JSON Idx -> Image filename)
 * JSON has specific order: weapons with both Damage+Health are at specific Idx values
 * This maps JSON Idx to the correct image filename
 */
const WEAPON_ORDER_MAP: Record<string, string[]> = {
    // Primitive: no shield weapons, alphabetical works
    'Primitive': [
        'IconPrimitiveWeaponAxe.png',
        'IconPrimitiveWeaponBlowgun.png',
        'IconPrimitiveWeaponBone.png',
        'IconPrimitiveWeaponBranch.png',
        'IconPrimitiveWeaponClub.png',
        'IconPrimitiveWeaponRock.png',
        'IconPrimitiveWeaponSlinger.png',
    ],
    // Medieval: Idx 0,1 are shield weapons (have Health)
    'Medieval': [
        'IconMedievalWeaponSpearandshield.png',    // Idx 0: Damage + Health
        'IconMedievalWeaponSwordandshield.png',    // Idx 1: Damage + Health
        'IconMedievalWeaponBow.png',               // Idx 2: Damage only
        'IconMedievalWeaponKatana.png',            // Idx 3
        'IconMedievalWeaponScythe.png',            // Idx 4
        'IconMedievalWeaponTomahawk.png',          // Idx 5
        'IconMedievalWeaponWarhammer.png',         // Idx 6
    ],
    // Early Modern: no shield weapons
    'Earlymodern': [
        'IconEarlymodernWeaponCrossbow.png',
        'IconEarlymodernWeaponDualpistols.png',
        'IconEarlymodernWeaponExecutioner.png',
        'IconEarlymodernWeaponMusket.png',
        'IconEarlymodernWeaponPiratessword.png',
        'IconEarlymodernWeaponRapier.png',
    ],
    // Modern: Idx 4 is Riotshield (has Health)
    'Modern': [
        'IconModernWeaponAk.png',                  // Idx 0
        'IconModernWeaponBaton.png',               // Idx 1
        'IconModernWeaponKnuckledusters.png',      // Idx 2
        'IconModernWeaponM4.png',                  // Idx 3
        'IconModernWeaponRiotshield.png',          // Idx 4: Damage + Health
        'IconModernWeaponSniper.png',              // Idx 5
        'IconModernWeaponUzi.png',                 // Idx 6
        'IconModernWeaponWrench.png',              // Idx 7
    ],
    // Space: no shield weapons
    'Space': [
        'IconSpaceWeaponBlaster.png',
        'IconSpaceWeaponRobotsword.png',
        'IconSpaceWeaponSaber.png',
        'IconSpaceWeaponSpacegun.png',
        'IconSpaceWeaponSpacepistol.png',
    ],
    // Interstellar: Idx 3 is Lightswordandshield (has Health)
    'Interstellar': [
        'IconInterstellarWeaponDualwieldmelee.png',    // Idx 0
        'IconInterstellarWeaponIonicblaster.png',      // Idx 1
        'IconInterstellarWeaponIsobariccutter.png',    // Idx 2
        'IconInterstellarWeaponLightswordandshield.png', // Idx 3: Damage + Health
        'IconInterstellarWeaponPlasmarifle.png',       // Idx 4
        'IconInterstellarWeaponRaygun.png',            // Idx 5
    ],
    // Multiverse: Idx 1 is Mentalspear (has Health)
    'Multiverse': [
        'IconMultiverseWeaponHolographictrident.png',  // Idx 0
        'IconMultiverseWeaponMentalspear.png',         // Idx 1: Damage + Health
        'IconMultiverseWeaponProjectedcutlass.png',    // Idx 2
        'IconMultiverseWeaponSimulatedbow.png',        // Idx 3
        'IconMultiverseWeaponVirtualgun.png',          // Idx 4
        'IconMultiverseWeaponVirtualsword.png',        // Idx 5
    ],
    // Quantum: Idx 5 is Blackswordandshield (has Health)
    'Quantum': [
        'IconQuantumWeaponBlackbow.png',               // Idx 0
        'IconQuantumWeaponBlackgun.png',               // Idx 1
        'IconQuantumWeaponBlackhammer.png',            // Idx 2
        'IconQuantumWeaponBlackspear.png',             // Idx 3
        'IconQuantumWeaponQuantumstaff.png',           // Idx 4
        'IconQuantumWeaponBlackswordandshield.png',    // Idx 5: Damage + Health
    ],
    // Underworld: TBD - check JSON
    'Underworld': [
        'IconUnderworldWeaponAbyssalFork.png',
        'IconUnderworldWeaponDoomMace.png',
        'IconUnderworldWeaponInfernalTrident.png',
        'IconUnderworldWeaponShadowScimitar.png',
        'IconUnderworldWeaponSoulpiercer.png',
    ],
    // Divine: TBD - check JSON
    'Divine': [
        'IconDivineWeaponAngelicpitchfork.png',
        'IconDivineWeaponDragondagger.png',
        'IconDivineWeaponSerpentsword.png',
        'IconDivineWeaponSirenssong.png',
        'IconDivineWeaponStaff.png',
        'IconDivineWeaponStaffofwisdom.png',
    ],
};


const ITEM_TYPE_MAP: Record<string, number> = {
    'Helmet': 0, 'Headgear': 0, 'Head': 0,
    'Armour': 1, 'Armor': 1, 'Body': 1,
    'Gloves': 2, 'Glove': 2, 'Hand': 2,
    'Necklace': 3, 'Neck': 3,
    'Ring': 4,
    'Weapon': 5,
    'Shoes': 6, 'Foot': 6, 'Boots': 6,
    'Belt': 7
};

export const getItemImage = (ageName: string, slotType: string, idx: number, autoMapping?: any): string | null => {
    // 1. Try dynamic mapping from JSON (AutoItemMapping)
    if (autoMapping) {
        const ageIndex = AGES.indexOf(ageName);
        const typeId = ITEM_TYPE_MAP[slotType];

        if (ageIndex !== -1 && typeId !== undefined) {
            const key = `${ageIndex}_${typeId}_${idx}`;
            const mapping = autoMapping[key];
            if (mapping && mapping.SpriteName) {
                return getAssetPath(mapping.SpriteName + '.png');
            }
        }
    }

    // 2. Fallback to old logic (Manual Maps & File Parsing)
    let cleanAge = ageName.replace('-', '').replace(' ', '');

    // Weapon specific fallback
    if (slotType === 'Weapon') {
        const weaponList = WEAPON_ORDER_MAP[cleanAge];
        if (weaponList && weaponList[idx]) {
            return getAssetPath(weaponList[idx]);
        }
        return null;
    }

    // Other slots fallback
    let fileSlot = slotType;
    if (slotType === 'Body' || slotType === 'Armour') fileSlot = 'Armor'; // Map Body/Armour -> Armor
    if (slotType === 'Head') fileSlot = 'Headgear';
    if (slotType === 'Hand') fileSlot = 'Glove';
    if (slotType === 'Necklace') fileSlot = 'Neck';
    if (slotType === 'Shoes') fileSlot = 'Foot';

    const prefix = `Icon${cleanAge}`;
    const ageAssets = ITEM_ASSETS.filter(a => a.toLowerCase().startsWith(prefix.toLowerCase()));

    // Custom filter for consistent results with old logic
    const slotAssets = ageAssets.filter(a => {
        const lower = a.toLowerCase();
        const pLower = prefix.toLowerCase();
        const rest = lower.replace(pLower, '');
        if (fileSlot === 'Foot') {
            return rest.startsWith('foot') || rest.startsWith('lfoot');
        }
        return rest.startsWith(fileSlot.toLowerCase());
    });

    slotAssets.sort();

    if (slotAssets[idx]) {
        return getAssetPath(slotAssets[idx]);
    }

    return null;
};

export const getItemName = (ageName: string, slotType: string, idx: number, autoMapping?: any): string | null => {
    // 1. Try dynamic mapping from JSON (AutoItemMapping)
    if (autoMapping) {
        const ageIndex = AGES.indexOf(ageName);
        const typeId = ITEM_TYPE_MAP[slotType];

        if (ageIndex !== -1 && typeId !== undefined) {
            const key = `${ageIndex}_${typeId}_${idx}`;
            const mapping = autoMapping[key];
            if (mapping && mapping.ItemName) {
                return mapping.ItemName.replace(/([a-z])([A-Z])/g, '$1 $2').replace('&', ' & ');
            }
        }
    }

    // 2. Fallback to old logic
    let cleanAge = ageName.replace('-', '').replace(' ', '');

    if (slotType === 'Weapon') {
        const weaponList = WEAPON_ORDER_MAP[cleanAge];
        if (weaponList && weaponList[idx]) {
            const filename = weaponList[idx];
            const prefix = `Icon${cleanAge}Weapon`;
            let name = filename.replace('.png', '');
            const lowerName = name.toLowerCase();
            if (lowerName.startsWith(prefix.toLowerCase())) {
                name = name.substring(prefix.length);
            }
            name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
            return name || null;
        }
        return null;
    }

    let fileSlot = slotType;
    if (slotType === 'Body' || slotType === 'Armour') fileSlot = 'Armor';
    if (slotType === 'Head') fileSlot = 'Headgear';
    if (slotType === 'Hand') fileSlot = 'Glove';
    if (slotType === 'Necklace') fileSlot = 'Neck';
    if (slotType === 'Shoes') fileSlot = 'Foot';

    const prefix = `Icon${cleanAge}`;
    const ageAssets = ITEM_ASSETS.filter(a => a.toLowerCase().startsWith(prefix.toLowerCase()));
    const slotAssets = ageAssets.filter(a => {
        const lower = a.toLowerCase();
        const pLower = prefix.toLowerCase();
        const rest = lower.replace(pLower, '');
        if (fileSlot === 'Foot') {
            return rest.startsWith('foot') || rest.startsWith('lfoot');
        }
        return rest.startsWith(fileSlot.toLowerCase());
    });

    slotAssets.sort();

    if (slotAssets[idx]) {
        const filename = slotAssets[idx];
        const prefixPattern = `Icon${cleanAge}${fileSlot}`;
        let name = filename.replace('.png', '');
        if (name.toLowerCase().startsWith(prefixPattern.toLowerCase())) {
            name = name.substring(prefixPattern.length);
        }
        if (fileSlot === 'Foot' && name.toLowerCase().startsWith('l')) {
            name = name.substring(1);
        }
        name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
        return name || null;
    }

    return null;
};
