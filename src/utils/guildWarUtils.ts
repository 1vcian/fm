/**
 * Standardizes Guild War timing based on 00:00 UTC reset.
 */

// Tuesday is Day 0

/**
 * Returns the Guild War day index (0-5) for a given date,
 * based on the 00:00 UTC reset.
 * 
 * Tuesday = 0
 * Wednesday = 1
 * Thursday = 2
 * Friday = 3
 * Saturday = 4
 * Sunday = 5
 * Monday = 5 (Battle Day / Carry over)
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
 * Checks if a specific date/time lands on a Guild War point day
 * for a specific category.
 */
export function isWarPointDay(date: Date, category: 'tech' | 'skills' | 'mounts' | 'eggs' | 'pets' | 'dungeons' | 'forge'): boolean {
    const idx = getWarDayIndex(date);
    
    switch (category) {
        case 'tech': return idx === 0 || idx === 3;
        case 'skills': return idx === 0 || idx === 2 || idx === 4;
        case 'mounts': return idx === 2 || idx === 4;
        case 'eggs': return idx === 1 || idx === 3;
        case 'pets': return idx === 1 || idx === 4;
        case 'dungeons': return idx === 1 || idx === 3 || idx === 4;
        case 'forge': return idx === 0 || idx === 2 || idx === 4; // Forge Crafting points
        default: return false;
    }
}

/**
 * Returns a human-readable name for the GW day based on the index.
 */
export function getWarDayName(idx: number): string {
    const names = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday/Monday'];
    return names[idx] || 'Unknown';
}
