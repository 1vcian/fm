/**
 * Main-battle difficulty names and colours.
 *
 * How many difficulties a build has comes from the config (`mainBattleDifficultyCount` in
 * src/engine/enemies.ts); this file only names them, exactly as the game does: a battle label is
 * Localize(GameContextExtensions.DifficultyLocaKeys[difficultyIdx]) (FormatBattleNumber,
 * 0x400C12C; the array is built in the class .cctor at 0x400E6F8). Index 0's key is "Battle";
 * the UI calls it Normal, the game's own word for the base difficulty.
 */

const NAMES = [
    'Normal', 'Hard', 'Extreme', 'Hell', 'Nightmare', 'Chaos', 'Void', 'Abyss', 'Eternal', 'Inferno',
] as const;

export function difficultyName(idx: number): string {
    return NAMES[idx] ?? `Difficulty ${idx + 1}`;
}

/** Full class strings, so Tailwind's scanner sees every one of them. */
export interface DifficultyStyle {
    /** Text + border of a block. */
    block: string;
    /** Icon chip background. */
    chip: string;
    /** Timeline divider line. */
    line: string;
    /** Timeline label / active text. */
    text: string;
    /** Active tab button. */
    tab: string;
}

const STYLES: DifficultyStyle[] = [
    {
        block: 'text-blue-400 border-blue-500/30',
        chip: 'bg-blue-500/20',
        line: 'bg-blue-500/50',
        text: 'text-blue-400',
        tab: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
    },
    {
        block: 'text-orange-400 border-orange-500/30',
        chip: 'bg-orange-500/20',
        line: 'bg-orange-500/50',
        text: 'text-orange-400',
        tab: 'bg-orange-500/20 text-orange-400 border-orange-500/50',
    },
    {
        block: 'text-red-400 border-red-500/30',
        chip: 'bg-red-500/20',
        line: 'bg-red-500/50',
        text: 'text-red-400',
        tab: 'bg-red-500/20 text-red-400 border-red-500/50',
    },
    {
        block: 'text-fuchsia-400 border-fuchsia-500/30',
        chip: 'bg-fuchsia-500/20',
        line: 'bg-fuchsia-500/50',
        text: 'text-fuchsia-400',
        tab: 'bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/50',
    },
];

export function difficultyStyle(idx: number): DifficultyStyle {
    return STYLES[Math.min(Math.max(idx, 0), STYLES.length - 1)];
}

/** "5-10" on Normal, "Hard 5-10" above it: the game's own stage label. */
export function stageLabel(difficultyIdx: number, ageIdx: number, battleIdx: number): string {
    const prefix = difficultyIdx > 0 ? `${difficultyName(difficultyIdx)} ` : '';
    return `${prefix}${ageIdx + 1}-${battleIdx + 1}`;
}
