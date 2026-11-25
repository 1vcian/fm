# Forge Predictor data audit

Configuration: `public/parsed_configs/2026_11_16_09_55` in this repository. Legacy 2.11.1 remains a separate selection. Inputs and forecasts record the selected model and forge ascension. Do not combine observations across configuration, forge level or ascension changes.

| Rule | Latest model |
| --- | --- |
| Normal item ages | 13, Primitive through Eternal |
| Normal item definitions | 295 |
| New ages | Heroic, Infinite, Eternal |
| New-age unlock | Forge ascension 3 |
| Displayed forge caps at ascension 0 / 1 / 2 / 3 | 35 / 35 / 35 / 50 |
| Substats before ascension | Age 0 to 2: zero; 3 to 6: one; 7 and above: two |
| Substats after any forge ascension | Two at every age |
| Equipment damage/health multipliers | 1 / 50 / 2500 / 125000 |
| Sale base | 20 coins |

Multipliers use the current ascension row, not cumulative multiplication. They do not multiply secondary percentages or sale coins. Ascending resets hidden item progression. The hammer estimate retains fresh versus mature hidden-counter assumptions and explicit per-slot level caps; it is an expectation, not a guaranteed payout. Primary health/damage amounts are not forecast by this tool.

Sources audited: GameTiers.json, ForgeUpgradeLibrary.json, AscensionConfigsLibrary.json, ItemBalancingLibrary.json, SecondaryStatLibrary.json, SecondaryStatItemUnlockLibrary.json, ItemBalancingConfig.json, AutoItemMapping.json and Localization.json. Implementation comparisons: src/utils/forgeConfig.ts, src/utils/ascensionUnlocks.ts, src/utils/forgeItemLevels.ts and src/pages/Items.tsx.

Validation covers PCG arithmetic against the Helper RNG, full-domain recovery from synthetic consecutive rolls, model/version persistence, ascension substat counts and forge caps, 5,000 latest-model fast versus BigInt forecasts, target scanning, cancellation, bounded result storage and hammer value. Public examples are synthetic and contain no player account snapshots. A fresh independent ascended in-game capture is still needed to establish live compatibility and rounding. These checks do not certify every server configuration or guarantee recovery from bonus-free gear.
