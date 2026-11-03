/**
 * Raise it to show the update popup once more to everyone, even to those who already saw the
 * current game data's popup (the app changed, not the data).
 */
export const RELEASE_NOTES_REVISION = '2026_11_03_fairies_attack';

/**
 * What changed in the app itself (not the game data) alongside a game data version. The update
 * popup shows these above the config changes for the same version.
 */
export const RELEASE_NOTES: Record<string, string[]> = {
    '2026_10_27_09_45': [
        'The new fairies are here: Mira (less damage taken from Critical Hits for your Skill Cooldown), Tira (Damage for your Health) and Lora (more Damage on every 5th attack), with their in-game values in the profile, the calculators, PvP and the Fairies wiki.',
        'Preset Builds now come with the new fairies, at 80, 85, 90, 95 and 100% substat rolls. Not every build can be calculated, there are far too many: these are the best found so far.',
        'New Attack wiki page: the ranking of every weapon and skin windup, ranged and melee, at the attack speed and double chance you set.',
    ],
    '2026_10_08_09_03': [
        'New Achievements wiki with the game\'s own titles and rewards.',
        'PvP works now, in beta test: fight a profile card screenshot, a saved profile or a fighter you build.',
        'Battle replays draw every skill, projectile, buff and hit.',
        'Simulators, stats and calculators checked against the game: missions, dungeons, waves, summons, forge and tech costs.',
        'One Summons calculator with Eggs, Mounts and Skills tabs; the Loadout search now lives in Compare Build.',
        'DPS and HPS now match the combat engine within 1%, with an engine check in the DPS breakdown.',
        'AUTO BEST finds the strongest build against the test dummy or in simulated PvP battles; tick what it may change: skills you have unlocked, pets, mount, fairy and archive skins.',
        'Skills Cycle opens a simulation popup: a PvP battle against a dummy at every cooldown reduction, with wasted casts, the next gain and where each skill lands.',
        'Substats Calculator: "Best build (simulated)" ranks substat sets by PvP battles, with or without skills; DPS and HPS totals now include reflect everywhere.',
        'Forge Calculator follows the game\'s hidden item level counters: gold and hammers are shown as a min to max range.',
        'Tech planner delays can be any length and edited.',
        'The screenshot scanner handles tablets, short phones and status bars.',
    ],
};
