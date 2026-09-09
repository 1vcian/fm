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
        // Standard PCG seeding: state = 0 -> advance -> state += seed -> advance, which
        // collapses to the closed form below.
        const s = BigInt(seed) & MASK64;
        this.state = (s * MULT + ((INC * MULT + INC) & MASK64)) & MASK64;
    }

    nextUInt32(): number {
        const old = this.state;
        this.state = (old * MULT + INC) & MASK64;
        const xorshifted = Number(((old >> 18n) ^ old) >> 27n & 0xffffffffn);
        const rot = Number(old >> 59n);
        return ((xorshifted >>> rot) | (xorshifted << (32 - rot))) >>> 0;
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
