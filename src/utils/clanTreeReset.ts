/**
 * The one shared clan tree reset: at 2026-11-03 00:00 UTC every clan's shared tree (clan_tree)
 * starts again from nothing. The site follows without writing to the server: a row last published
 * before it reads as empty (getClanTree, getClanTreeInfo) until a leader publishes again. The
 * profiles' own techTree.Clan levels are not reset, and the auto-pull does not copy the empty row.
 */
import { NEW_SEASON_FROM } from './fairies';

/** 2026-11-03 00:00 UTC, with the November 2026 fairy season. */
export const CLAN_TREE_RESET = NEW_SEASON_FROM;

/** Saved (an ISO time or epoch ms) before the reset, read once it has happened. */
export function beforeClanTreeReset(savedAt: string | number | null | undefined, now = Date.now()): boolean {
    if (now < CLAN_TREE_RESET) return false;
    const at = typeof savedAt === 'number' ? savedAt : savedAt ? Date.parse(savedAt) : NaN;
    return !Number.isFinite(at) || at < CLAN_TREE_RESET;
}
