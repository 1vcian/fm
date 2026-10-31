/**
 * Raise it to show the update popup once more to everyone, even to those who already saw the
 * current game data's popup (the app changed, not the data).
 */
export const RELEASE_NOTES_REVISION = '2026_10_31';

/**
 * What changed in the app itself (not the game data) alongside a game data version. The update
 * popup shows these above the config changes for the same version.
 */
export const RELEASE_NOTES: Record<string, string[]> = {
    '2026_10_27_09_45': [
        'Now you can drag and hide the Buy Me a Coffee button under the header!',
        'New Preset Builds page: the strongest builds the game allows for power, DPS and HPS (melee and ranged), the main quest and the arena, with their exact equivalents and an arena tournament. Calculate your best variants with only the skins you own, fight against every build with your profile to see where you rank, and add any build to your profiles as your own copy.',
        'New Images Maker page: build a character with any items, skins, mount, pets and fairy, next to the clan emblem designer, and export it as a PNG or a looping GIF.',
        'Graphic improvements: game icons across the whole app, exact skin icons, animated Max set effects, characters drawn as in battle, and late age item backgrounds drawn with the game\'s own shaders.',
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
