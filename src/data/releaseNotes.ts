/**
 * What changed in the app itself (not the game data) alongside a game data version. The update
 * popup shows these above the config changes for the same version.
 */
export const RELEASE_NOTES: Record<string, string[]> = {
    '2026_10_27_09_45': [
        'Skin icons now come from the game files, one exact picture per skin, including the new Santa, Snowboard and Snowman weapons.',
        'New sets Crimson Faemoth, Umbral Shade and Granite Warden, and set pieces always listed as Helmet, Armour, Weapon.',
        'Main battle shows all three difficulties again for this build.',
        'Skins & Sets: every set now shows its Max set effect, animated from the game files: the effect around the character and the one on death, for a complete set at max level.',
        'Battles follow the new game rules: Incoming Crit Damage Reduction and the bonus on every 5th attack, ready for the fairies that will grant them, plus flat and uncapped fairies.',
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
