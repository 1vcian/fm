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

## Native calculator UI audit

The integrated calculator now renders React controls directly, rather than an iframe. It reuses Card, Button, Input, SecondaryStatCard, ItemSelectionCard, getStatName, getItemImage and resolveTextureVersion. Item selection is isolated from profile inventory and never equips or saves gear to the profile. The image picker supports age, equipment and name filtering, keyboard selection, Escape, focus containment and focus restoration.

The profile's SecondaryStatInput commits a number on blur, clamps to a range and rounds to two decimals. Those behaviors lose evidence needed by inverse recovery, particularly trailing zeros. SecondaryStatCard now accepts an optional custom value input; existing consumers keep their previous behavior. Predictor values remain strings, including commas and trailing zeros, until validation in the worker. Displayed precision controls the matching interval. Invalid ranges, duplicate stats, mutually exclusive melee/ranged bonuses and weapon-incompatible bonuses produce errors instead of silent correction.

All 13 canonical equipment stats, including Damage, use the Helper's display names. Disabled choices reflect the actual model pool, duplicate selections and weapon restrictions. Substat ranges are drawn from the same audited SecondaryStatLibrary values bundled with each model. Actual item icons use the Helper mapping and texture-version resolution, with an anvil fallback on missing artwork. Ambiguous predictions display every compatible item variant and its bonuses, without presenting one image as certain.

Roll entry uses a compact thumbnail history and a single selected editor, with previous/next navigation. Unknown rolls preserve sequence positions. Saved input migration, model metadata, automatic recovery, cancellation, stale worker rejection, exact current-seed indexing, target filters, bounded retained results and hammer estimates remain supported. Target hunts have no preset roll or time horizon; user cancellation stops them. Recovery alone has an explicit time limit. Changing evidence invalidates all dependent predictions. Filters invalidate scan results. Production UI no longer includes asset-source prose. Solver copyright and license notices remain available.

Validation: existing arithmetic, inversion, scan, automatic search and hammer regressions; native worker recovery from synthetic data; native import, precision and stat-eligibility checks; TypeScript and Vite production build. The live page still requires independent ascended in-game captures for game-accuracy validation.
