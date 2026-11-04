import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { UserProfile } from '../../types/Profile';
import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { createRemoteProfileStore } from '../../services/profileStore';
import { exchangeRowsV1, profileToExchange } from '../../utils/profileExchange';
import type { ChangeRow } from '../../utils/ocr/autoSync';

/** Lines shown before "and N more". */
const SHOWN = 8;

const TREE_NAMES: Record<string, string> = { Forge: 'Forge tree', Power: 'Power tree', SkillsPetTech: 'Skills & pets tree', Clan: 'Clan tree' };
/** Parts of a profile the exchange rows do not cover, by what a player calls them. */
const OTHER_PARTS: [string, (p: UserProfile) => unknown][] = [
    ['name', p => p.name],
    ['fairy', p => p.misc?.fairy],
    ['dungeon levels', p => p.misc?.dungeonLevels],
    ['saved items', p => p.savedItems],
    ['pet collection and saved pets', p => [p.pets?.collection, p.pets?.savedBuilds]],
    ['saved mounts', p => [p.mount?.collection, p.mount?.savedBuilds]],
    ['skins', p => p.skins],
    ['equipped skills', p => p.skills?.equipped?.map(s => s.id)],
    ['planner and calculators', p => [p.misc?.techPlanQueue, p.misc?.forgeCalculator, p.misc?.ownedEggs, p.misc?.eggSlots, p.misc?.researchLevel]],
];

const here = (a: string | number, b: string | number) => `${a} here, ${b} in the account`;
const subsKey = (s?: { statId: string; value: number }[]) => JSON.stringify((s ?? []).map(x => [x.statId, Math.round(x.value * 100)]));

/** One short line per differing thing: only what differs, this browser first. */
function lineOf(r: ChangeRow, local: UserProfile): string {
    const p = r.patch;
    const unitParts = (cur: { rarity: string; id: number; level: number; ascensionLevel?: number; secondaryStats?: any[] } | null | undefined,
        next: { rarity: string; id: number; level: number; ascensionLevel?: number; secondaryStats?: any[] }) => {
        if (!cur) return 'none here';
        if (cur.rarity !== next.rarity || cur.id !== next.id) return here(`${cur.rarity} #${cur.id}`, `${next.rarity} #${next.id}`);
        const parts: string[] = [];
        if (cur.level !== next.level) parts.push(here(`Lv.${cur.level}`, `Lv.${next.level}`));
        if ((cur.ascensionLevel ?? 0) !== (next.ascensionLevel ?? 0)) parts.push(here(`${cur.ascensionLevel ?? 0} stars`, `${next.ascensionLevel ?? 0} stars`));
        if (subsKey(cur.secondaryStats) !== subsKey(next.secondaryStats)) parts.push('different substats');
        return parts.join('; ') || 'different';
    };
    switch (p.t) {
        case 'item': {
            const cur = (local.items as any)[p.slot];
            if (!cur) return `${r.label}: none here`;
            if (cur.age !== p.item.age || cur.idx !== p.item.idx) return `${p.slot}: ${r.before?.split(' Lv.')[0] ?? 'another item'} here, ${r.label.slice(p.slot.length + 2)} in the account`;
            const parts: string[] = [];
            if (cur.level !== p.item.level) parts.push(here(`Lv.${cur.level}`, `Lv.${p.item.level}`));
            if (subsKey(cur.secondaryStats) !== subsKey(p.item.secondaryStats)) parts.push('different substats');
            return `${r.label}: ${parts.join('; ') || 'different'}`;
        }
        case 'pet': return `Pet slot ${p.slotIndex + 1}: ${unitParts(local.pets.active?.[p.slotIndex], p.pet)}`;
        case 'mount': return `Mount: ${unitParts(local.mount.active, p.mount)}`;
        case 'skinEquip': return `${p.slot} skin: different`;
        default: return `${r.label}: ${here(r.before ?? 'none', r.after)}`;
    }
}

/**
 * What differs between this browser's copy of a profile and the account's, in a few lines, so a
 * "Changed in both places" row can be decided by looking. The account copy is read once when the
 * row is shown. Gear, pets, mount, skills, forge and currencies are compared as the profile
 * exchange does (the same labels as an AutoSync review); trees by how many nodes differ; the rest
 * by name only.
 */
export function MergeChangePreview({ id }: { id: string }) {
    const { profiles } = useProfile();
    const local = profiles.find(p => p.id === id) ?? null;
    const { data: autoItemMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: localization } = useGameData<any>('Localization.json');
    const [server, setServer] = useState<UserProfile | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        const store = createRemoteProfileStore();
        if (!store) { setError('No account to compare with.'); return; }
        store.get(id).then(r => {
            if (!live) return;
            if (r.ok) setServer(r.record.body); else setError(r.message || 'The account copy could not be read.');
        });
        return () => { live = false; };
    }, [id]);

    const lines = useMemo(() => {
        if (!local || !server) return null;
        const out: string[] = [];
        // "before" is this browser, "after" is the account.
        for (const r of exchangeRowsV1(profileToExchange(server), local, { autoItemMapping, localization })) out.push(lineOf(r, local));
        for (const tree of Object.keys(TREE_NAMES) as (keyof UserProfile['techTree'])[]) {
            const a = local.techTree?.[tree] ?? {}, b = server.techTree?.[tree] ?? {};
            const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
            let n = 0;
            for (const k of ids) if (Number((a as any)[k] ?? 0) !== Number((b as any)[k] ?? 0)) n++;
            if (n) out.push(`${TREE_NAMES[tree]}: ${n} node${n === 1 ? '' : 's'} at a different level`);
        }
        const other = OTHER_PARTS.filter(([, get]) => JSON.stringify(get(local) ?? null) !== JSON.stringify(get(server) ?? null)).map(([name]) => name);
        if (other.length) out.push(`Also different: ${other.join(', ')}`);
        return out;
    }, [local, server, autoItemMapping, localization]);

    const [all, setAll] = useState(false);
    if (error) return <div className="mt-2 text-[11px] text-text-muted">{error}</div>;
    if (!lines) return <div className="mt-2 text-[11px] text-text-muted flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Comparing with the account copy</div>;
    if (!lines.length) return <div className="mt-2 text-[11px] text-text-muted">No difference in gear, pets, mount, skills, trees or resources: the two copies only differ in settings this preview does not show.</div>;
    const shown = all ? lines : lines.slice(0, SHOWN);
    return (
        <div className="mt-2 rounded-lg bg-black/25 border border-white/5 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest font-bold text-text-muted mb-1">What differs</div>
            <ul className="space-y-0.5 text-[11px] text-text-secondary">
                {shown.map((l, i) => <li key={i} className="break-words">{l}</li>)}
            </ul>
            {lines.length > SHOWN && (
                <button type="button" onClick={() => setAll(a => !a)} className="mt-1 text-[11px] font-semibold text-accent-primary hover:underline">
                    {all ? 'Show less' : `and ${lines.length - SHOWN} more`}
                </button>
            )}
        </div>
    );
}
