/**
 * Standardizes Guild War timing based on 00:00 UTC reset.
 *
 * IMPORTANT: nothing here hard-codes which day a category is active on.
 * Day assignments change between game config versions, so the day → category
 * mapping is derived dynamically from GuildWarDayConfigLibrary.json. The day
 * information is only used to *recommend* which calculator is worth using today;
 * the calculators themselves compute war points regardless of the current day.
 */

// Tuesday is Day 0

export type WarCategory = 'tech' | 'skills' | 'mounts' | 'eggs' | 'pets' | 'dungeons' | 'forge' | 'forgeSpend';

/**
 * Returns the Guild War day index (0-5) for a given date,
 * based on the 00:00 UTC reset.
 *
 * Tuesday = 0, Wednesday = 1, Thursday = 2, Friday = 3, Saturday = 4,
 * Sunday = 5, Monday = 5 (Battle Day / Carry over)
 */
export function getWarDayIndex(date: Date = new Date()): number {
    const utcDay = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 2=Tue

    const mapping: Record<number, number> = {
        2: 0, // Tue
        3: 1, // Wed
        4: 2, // Thu
        5: 3, // Fri
        6: 4, // Sat
        0: 5, // Sun
        1: 5  // Mon
    };

    return mapping[utcDay] ?? 0;
}

/**
 * Classifies a Guild War task name into a war category.
 * Kept in one place so every consumer agrees on what counts as e.g. "eggs".
 */
export function classifyWarTask(taskName: string): WarCategory | null {
    if (!taskName) return null;
    if (/TechTreeUpgrade$/.test(taskName)) return 'tech';
    if (/Skill$/.test(taskName) && (/^Summon/.test(taskName) || /^Upgrade/.test(taskName))) return 'skills';
    if (/Mount$/.test(taskName) && (/^Summon/.test(taskName) || /^Merge/.test(taskName))) return 'mounts';
    if (/^Hatch.*Egg$/.test(taskName)) return 'eggs';
    if (/^Merge.*Pet$/.test(taskName)) return 'pets';
    if (/DungeonKey$/.test(taskName)) return 'dungeons';
    if (/^Forge.*Equipment$/.test(taskName)) return 'forge';
    if (taskName === 'SpendCoinsOnForge' || taskName === 'SpendGemOnForge') return 'forgeSpend';
    return null;
}

/**
 * Builds a category → sorted day-index list map from GuildWarDayConfigLibrary.json.
 */
export function computeWarDaysMap(dayConfig: any): Partial<Record<WarCategory, number[]>> {
    const map: Partial<Record<WarCategory, number[]>> = {};
    if (!dayConfig) return map;
    Object.entries(dayConfig).forEach(([dayKey, dayData]: [string, any]) => {
        const idx = Number(dayKey);
        (dayData?.Tasks || []).forEach((task: any) => {
            const cat = classifyWarTask(task?.Task);
            if (!cat) return;
            if (!map[cat]) map[cat] = [];
            if (!map[cat]!.includes(idx)) map[cat]!.push(idx);
        });
    });
    for (const cat of Object.keys(map) as WarCategory[]) {
        map[cat]!.sort((a, b) => a - b);
    }
    return map;
}

/**
 * Finds the WarPointsReward amount for a specific task, searching every day.
 * This makes calculators independent of which day a task happens to live on.
 */
export function getWarPointsForTask(dayConfig: any, taskName: string): number {
    if (!dayConfig) return 0;
    for (const dayData of Object.values(dayConfig) as any[]) {
        const task = dayData?.Tasks?.find((t: any) => t.Task === taskName);
        if (task) {
            const reward = task.Rewards?.find((r: any) => r.$type === 'WarPointsReward');
            if (reward?.Amount !== undefined) return reward.Amount;
        }
    }
    return 0;
}

/**
 * Checks if a specific date lands on a Guild War point day for a category.
 * Pass the loaded GuildWarDayConfigLibrary.json — it is the ONLY source of the answer. Without it
 * this returns `false` rather than guessing; see the comment at the fallback for why.
 */
export function isWarPointDay(date: Date, category: WarCategory, dayConfig?: any): boolean {
    const idx = getWarDayIndex(date);

    if (dayConfig) {
        const days = computeWarDaysMap(dayConfig)[category] || [];
        return days.includes(idx);
    }

    /**
     * NO CONFIG, NO ANSWER — deliberately, and this used to be a hard-coded day layout.
     *
     * Every caller (the three calculator hooks, Dungeons, ForgeCalculator, TreeCalculator,
     * MountCalculator, SkillCalculator) passes a config that is `undefined` while `useGameData` is
     * still fetching, so the fallback fired on real page loads rather than in some corner case. It
     * listed `tech: 1|4, skills: 0|2, mounts: 1|3, ` — which matches today's
     * `GuildWarDayConfigLibrary.json` **by coincidence**. Day assignments genuinely move between
     * config versions (`day 5 DayPoints` went 2 -> 4 between 2026_01_25 and 2026_02_09, and three of
     * the 23 shipped versions carry genuinely different layouts), so the day the game reshuffles them
     * every calculator would have shown a confident "war day!" badge derived from a table nobody
     * remembered was there.
     *
     * `false` is the honest answer to "is today a war point day for this category" when the file that
     * decides it has not arrived: the badge simply does not appear for the few hundred milliseconds
     * before the config lands, instead of appearing on the strength of a guess. No caller treats this
     * as an error — they all render an optional highlight — so a brief `false` costs nothing, while a
     * wrong `true` sends someone to spend resources on the wrong day.
     */
    void idx;
    return false;
}

/**
 * The clan tech tree node type that boosts war points earned on the given day.
 * Days are 1-indexed in the node names (WarPointsOnDay1 = Tuesday / day index 0).
 */
export function getDayBoostNodeType(date: Date = new Date()): string {
    return `WarPointsOnDay${getWarDayIndex(date) + 1}`;
}

/**
 * Returns a human-readable name for the GW day based on the index.
 */
export function getWarDayName(idx: number): string {
    const names = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday/Monday'];
    return names[idx] || 'Unknown';
}
