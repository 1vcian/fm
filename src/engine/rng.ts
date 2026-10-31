/**
 * RandomPCG — the game's PRNG (Metaplay RandomPCG, PCG-XSH-RR 64/32).
 *
 * One instance drives a whole battle (AttacksSystem._random, seeded with the battle seed),
 * and every roll in combat consumes exactly one NextF64. The engine reproduces the stream so
 * a seeded simulation is bit-reproducible run to run.
 *
 * The game compares rolls as FD6 (micro-units, truncated), not as floats:
 * `FD6(NextF64()) <= chance` — so the helpers below compare integer micro values, which
 * keeps boundary behaviour (chance 0, chance 1, tiny chances) identical to the binary.
 */

const MULT = 6364136223846793005n;
const INC = 1442695040888963407n;
const MASK64 = (1n << 64n) - 1n;

export class RandomPCG {
    private state: bigint;

    constructor(seed: bigint | number) {
        // ctor(ulong) 0x72CB814 / CreateFromSeed 0x72CB9CC: state = seed * MULT + 0x1A08EE1184BA6D32,
        // which is INC * MULT + INC: the standard PCG seeding collapsed to one step.
        const s = BigInt(seed) & MASK64;
        this.state = (s * MULT + ((INC * MULT + INC) & MASK64)) & MASK64;
    }

    /**
     * NextUInt (0x72CBA4C) / NextF64 (0x72CBEAC): the rotation is assembled with ADD, not OR
     * (`lsr w12, w10, w13; lsl w10, w10, -w13; add w0, w10, w12`). For rot != 0 the two halves
     * do not overlap and ADD equals OR; for rot == 0 both shifts are 0 and the output is
     * 2 * xorshifted mod 2^32, which is what the game returns on 1 draw in 32.
     */
    nextUInt32(): number {
        const old = this.state;
        this.state = (old * MULT + INC) & MASK64;
        const xorshifted = Number(((old >> 18n) ^ old) >> 27n & 0xffffffffn);
        const rot = Number(old >> 59n);
        return ((xorshifted >>> rot) + ((xorshifted << ((32 - rot) & 31)) >>> 0)) >>> 0;
    }

    /** Uniform [0,1), 32 bits of entropy — matches the game's NextF64 as used in combat. */
    nextF64(): number {
        return this.nextUInt32() / 4294967296;
    }

    /** `FD6(roll) <= chance`, the comparator used by dodge, block, reflect and double attack. */
    rollLE(chance: number): boolean {
        return Math.floor(this.nextF64() * 1e6) <= Math.round(chance * 1e6);
    }

    /** `FD6(roll) < chance`, strict — used only by the crit roll. */
    rollLT(chance: number): boolean {
        return Math.floor(this.nextF64() * 1e6) < Math.round(chance * 1e6);
    }
}

/**
 * The seed of the i-th run of a multi-run simulation (i = 1, 2, ...): splitmix64(i), a well
 * spread 64-bit value. Seeding RandomPCG with i itself is exact but statistically poor: the
 * game's seeding (state = seed x MULT + constant) puts small consecutive seeds in correlated
 * states, and measured over the same duel the mean of seeds 1..100 came out 50% above the mean
 * of later seeds. A replay of a real battle passes its own seed straight to RandomPCG instead.
 */
export function runSeed(i: number): bigint {
    let z = (BigInt(i) * 0x9E3779B97F4A7C15n) & MASK64;
    z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & MASK64;
    return z ^ (z >> 31n);
}
