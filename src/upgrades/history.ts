/**
 * Progress history: timestamped snapshots of where the sim says a build gets, and what the player
 * says they have reached, per profile. Stored in this browser; export and import move them.
 */
import LZString from 'lz-string';
import { useCallback, useEffect, useState } from 'react';
import type { BattleTarget } from '../progress/battleWorker';
import type { UserProfile } from '../types/Profile';
import { difficultyName } from '../utils/difficulty';
import { battleName, type RankMode } from './ranking';

const HISTORY_KEY = 'fm.progressHistory.v1';
const ACTUAL_KEY = 'fm.progressActual.v1';
const EVENT = 'fm-progress-history-changed';
const EXPORT_KIND = 'forgemaster-progress-history';
const DAY = 86_400_000;

export type ModeLevels = Partial<Record<RankMode, number>>;

export interface Snapshot {
    id: string;
    profileId: string;
    at: number;
    version: string;
    /** In-game Power (substats left out, as the game computes it). */
    power: number;
    /** Last battle cleared per mode, as an index in the mode's line. */
    cleared: ModeLevels;
    /** What the player says they have cleared, indexed the same way. */
    actual: ModeLevels;
    note?: string;
    /** LZ-compressed profile, so an old snapshot can be read again later. */
    profile?: string;
}

function read<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function write(key: string, value: unknown): boolean {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        window.dispatchEvent(new Event(EVENT));
        return true;
    } catch {
        return false;
    }
}

const loadAll = () => read<Snapshot[]>(HISTORY_KEY, []);

export const snapshotsFor = (profileId: string) => loadAll().filter(s => s.profileId === profileId).sort((a, b) => a.at - b.at);

export function makeSnapshot(profile: UserProfile, version: string, power: number, cleared: ModeLevels, actual: ModeLevels, note?: string): Snapshot {
    return {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        profileId: profile.id,
        at: Date.now(),
        version,
        power,
        cleared,
        actual: { ...actual },
        note: note?.trim() || undefined,
        profile: LZString.compressToUTF16(JSON.stringify(profile)),
    };
}

/** False when storage is full or blocked. */
export const saveSnapshot = (s: Snapshot) => write(HISTORY_KEY, [...loadAll(), s]);

export const deleteSnapshot = (id: string) => { write(HISTORY_KEY, loadAll().filter(s => s.id !== id)); };

export function snapshotProfile(s: Snapshot): UserProfile | null {
    if (!s.profile) return null;
    try {
        return JSON.parse(LZString.decompressFromUTF16(s.profile) || 'null');
    } catch {
        return null;
    }
}

export const exportHistory = (profileId: string) => JSON.stringify({ kind: EXPORT_KIND, v: 1, snapshots: loadAll().filter(s => s.profileId === profileId) });

/** Merges an export into `profileId`, skipping snapshots already here. Returns how many were added. */
export function importHistory(json: string, profileId: string): number {
    const parsed = JSON.parse(json);
    if (parsed?.kind !== EXPORT_KIND || !Array.isArray(parsed.snapshots)) throw new Error('Not a progress history export');
    const all = loadAll();
    const have = new Set(all.map(s => s.id));
    const incoming = (parsed.snapshots as Snapshot[])
        .filter(s => s && typeof s.at === 'number' && !have.has(s.id))
        .map(s => ({ ...s, profileId }));
    if (!write(HISTORY_KEY, [...all, ...incoming])) throw new Error('Browser storage is full');
    return incoming.length;
}

export function useSnapshots(profileId: string): Snapshot[] {
    const [list, setList] = useState(() => snapshotsFor(profileId));
    useEffect(() => {
        const refresh = () => setList(snapshotsFor(profileId));
        refresh();
        window.addEventListener(EVENT, refresh);
        window.addEventListener('storage', refresh);
        return () => {
            window.removeEventListener(EVENT, refresh);
            window.removeEventListener('storage', refresh);
        };
    }, [profileId]);
    return list;
}

/** What the player has entered as reached in game, per mode. */
export function useActualProgress(profileId: string): [ModeLevels, (mode: RankMode, level: number | null) => void] {
    const [all, setAll] = useState<Record<string, ModeLevels>>(() => read(ACTUAL_KEY, {}));
    const set = useCallback((mode: RankMode, level: number | null) => {
        setAll(prev => {
            const cur = { ...prev[profileId] };
            if (level === null) delete cur[mode];
            else cur[mode] = level;
            const next = { ...prev, [profileId]: cur };
            try { localStorage.setItem(ACTUAL_KEY, JSON.stringify(next)); } catch { /* per-device only */ }
            return next;
        });
    }, [profileId]);
    return [all[profileId] ?? {}, set];
}

// ---- battles as typed ------------------------------------------------------------------------

/** Index in `line` of a typed battle: "Hard 6-14", "6-14" (the first difficulty) or a dungeon level. -1: no such battle. */
export function parseBattle(text: string, line: BattleTarget[]): number {
    const t = text.trim();
    if (line[0]?.mode === 'dungeon') {
        const n = /^(?:level\s+|lv\.?\s*)?(\d+)$/i.exec(t);
        return n && +n[1] >= 1 && +n[1] <= line.length ? +n[1] - 1 : -1;
    }
    const m = /^(?:([a-z]+)\s+)?(\d+)\s*[-.\s]\s*(\d+)$/i.exec(t);
    if (!m) return -1;
    return line.findIndex(b => b.mode === 'main' && b.ageIdx === +m[2] - 1 && b.battleIdx === +m[3] - 1
        && (m[1] ? difficultyName(b.difficulty).toLowerCase() === m[1].toLowerCase() : b.difficulty === 0));
}

/** The next milestone from where a mode stands (`done` battles cleared): the next age, or the next ten dungeon levels. */
export function defaultTarget(done: number, line: BattleTarget[]): string {
    const at = line[Math.max(0, done - 1)];
    if (at?.mode === 'main') {
        const next = line.findIndex((b, i) => i >= done && b.mode === 'main' && (b.ageIdx !== at.ageIdx || b.difficulty !== at.difficulty));
        return battleName(line[next >= 0 ? next : line.length - 1]);
    }
    return battleName(line[Math.min(line.length - 1, Math.floor(done / 10) * 10 + 9)]);
}

// ---- forecast --------------------------------------------------------------------------------

export interface Trend {
    /** Battles per day, from a least-squares fit. */
    perDay: number;
    points: number;
    spanDays: number;
    /** Battles cleared at the last point. */
    latest: number;
}

/**
 * The pace in one mode over the last `windowDays`: from what the player reported where they did,
 * from the sim otherwise. Needs two snapshots at least 6 hours apart.
 */
export function trendFor(snaps: Snapshot[], mode: RankMode, windowDays = 21): Trend | null {
    const pts = snaps
        .map(s => ({ t: s.at, v: (s.actual?.[mode] ?? s.cleared[mode]) }))
        .filter((p): p is { t: number; v: number } => p.v !== undefined)
        .map(p => ({ t: p.t, v: p.v + 1 }));
    if (pts.length < 2) return null;
    const lastT = pts[pts.length - 1].t;
    const used = pts.filter(p => lastT - p.t <= windowDays * DAY);
    if (used.length < 2) return null;
    const span = (used[used.length - 1].t - used[0].t) / DAY;
    if (span < 0.25) return null;
    const n = used.length;
    const mt = used.reduce((a, p) => a + p.t, 0) / n;
    const mv = used.reduce((a, p) => a + p.v, 0) / n;
    let num = 0, den = 0;
    for (const p of used) {
        num += (p.t - mt) * (p.v - mv);
        den += (p.t - mt) ** 2;
    }
    return { perDay: den > 0 ? (num / den) * DAY : 0, points: n, spanDays: span, latest: used[n - 1].v };
}

/** When a target (battles cleared) falls at this pace. */
export function eta(t: Trend, target: number): string {
    if (t.latest >= target) return 'reached';
    if (t.perDay <= 0.01) return 'not at this pace';
    const days = (target - t.latest) / t.perDay;
    if (days < 1) return `~${Math.max(1, Math.round(days * 24))}h`;
    if (days > 365) return 'over a year';
    return `~${days < 10 ? days.toFixed(1) : Math.round(days)} days`;
}
