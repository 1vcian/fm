/**
 * Every single level the player can buy next: tech nodes whose prerequisites are met, and the
 * equipped pets, mount and skills. Each candidate carries the whole profile with that one level added.
 */
import type { LibraryData } from '../utils/statEngine';
import type { SkillSlot, UserProfile } from '../types/Profile';

export type UpgradeKind = 'tech' | 'pet' | 'mount' | 'skill';

export interface UpgradeCandidate {
    key: string;
    kind: UpgradeKind;
    label: string;
    detail: string;
    /** Tech potions; only tech nodes have one here. */
    cost?: number;
    /** Research seconds. */
    duration?: number;
    profile: UserProfile;
}

type TreeName = 'Forge' | 'Power' | 'SkillsPetTech';
const TREES: TreeName[] = ['Power', 'SkillsPetTech', 'Forge'];
const TREE_LABEL: Record<TreeName, string> = { Power: 'Power', SkillsPetTech: 'Skills & Pets', Forge: 'Forge' };

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const spaced = (id: string) => id.replace(/([a-z])([A-Z])/g, '$1 $2');

/** The display name of a pet or mount, from ManualSpriteMapping.json. */
function unitName(sprites: any, kind: 'pets' | 'mounts', rarity: string, id: number): string | null {
    for (const v of Object.values<any>(sprites?.[kind]?.mapping ?? {})) {
        if (v.rarity === rarity && v.id === id) return spaced(String(v.name));
    }
    return null;
}

/** `upgradeLib`: TechTreeUpgradeLibrary.json, `sprites`: ManualSpriteMapping.json. Both may still be loading. */
export function upgradeCandidates(profile: UserProfile, libs: LibraryData, upgradeLib: any, sprites: any): UpgradeCandidate[] {
    const out: UpgradeCandidate[] = [];
    const stat = libs as any;

    for (const tree of TREES) {
        const levels = profile.techTree?.[tree] ?? {};
        for (const node of stat.techTreePositionLibrary?.[tree]?.Nodes ?? []) {
            const cur = levels[node.Id] ?? 0;
            if (cur >= (stat.techTreeLibrary?.[node.Type]?.MaxLevel ?? 0)) continue;
            if (!(node.Requirements ?? []).every((r: number) => (levels[r] ?? 0) >= 1)) continue;
            const price = upgradeLib?.[String(node.Tier ?? 0)]?.Levels?.find((l: any) => l.Level === cur);
            const p = clone(profile);
            p.techTree[tree] = { ...levels, [node.Id]: cur + 1 };
            out.push({
                key: `tech:${tree}:${node.Id}`,
                kind: 'tech',
                label: spaced(node.Type),
                detail: `${TREE_LABEL[tree]} tree, tier ${(node.Tier ?? 0) + 1}, level ${cur} → ${cur + 1}`,
                cost: price?.Cost,
                duration: price?.Duration,
                profile: p,
            });
        }
    }

    // Past the level cap the stat engine falls back to level 1 stats, which would read as a huge loss.
    (profile.pets.active ?? []).forEach((pet, i) => {
        if (pet.level >= (stat.petUpgradeLibrary?.[pet.rarity]?.LevelInfo?.length ?? 0)) return;
        const p = clone(profile);
        p.pets.active[i] = { ...pet, level: pet.level + 1 };
        out.push({
            key: `pet:${i}`, kind: 'pet', profile: p,
            label: unitName(sprites, 'pets', pet.rarity, pet.id) ?? `Pet ${i + 1}`,
            detail: `${pet.rarity}, level ${pet.level} → ${pet.level + 1}`,
        });
    });

    const mount = profile.mount.active;
    if (mount && mount.level < (stat.mountUpgradeLibrary?.[mount.rarity]?.LevelInfo?.length ?? 0)) {
        const p = clone(profile);
        p.mount.active = { ...mount, level: mount.level + 1 };
        out.push({
            key: 'mount', kind: 'mount', profile: p,
            label: unitName(sprites, 'mounts', mount.rarity, mount.id) ?? 'Mount',
            detail: `${mount.rarity}, level ${mount.level} → ${mount.level + 1}`,
        });
    }

    // A skill level raises the owned skill's passive, and the active effect too when it is equipped.
    const equipped = profile.skills.equipped ?? [];
    const passives = profile.skills.passives ?? {};
    const ids = new Set([...equipped.map(s => s.id), ...Object.keys(passives).filter(id => passives[id] > 0)]);
    for (const id of ids) {
        const i = equipped.findIndex((s: SkillSlot) => s.id === id);
        const from = i >= 0 ? equipped[i].level : passives[id];
        const rarity = stat.skillLibrary?.[id]?.Rarity ?? 'Common';
        const cap = stat.skillPassiveLibrary?.[rarity]?.LevelStats?.length ?? 0;
        if (from >= cap || (passives[id] ?? 0) >= cap) continue;
        const p = clone(profile);
        if (i >= 0) p.skills.equipped[i] = { ...equipped[i], level: from + 1 };
        if (passives[id] !== undefined) p.skills.passives = { ...passives, [id]: passives[id] + 1 };
        out.push({
            key: `skill:${id}`, kind: 'skill', profile: p,
            label: spaced(id),
            detail: `${i >= 0 ? 'Equipped' : 'Passive only'}, level ${from} → ${from + 1}`,
        });
    }
    return out;
}
