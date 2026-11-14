import argon2 from "argon2";

// Per-process admission limits: no waiting queue and at most two Argon2 jobs.
// Use verified user IDs only; cap retained cooldown entries as well as work.
const MAX_ACTIVE_HASHES = 2;
const HASH_COOLDOWN_MS = 10_000;
const MAX_COOLDOWNS = 1024;
let activeHashes = 0;
const cooldowns = new Map<string, number>();

/** Returns null when admission is denied; never persist it as a password hash. */
export const hashPassword = async (
    password: string,
    userId: string,
): Promise<string | null> => {
    const now = Date.now();
    for (const [id, until] of cooldowns) {
        if (until <= now) cooldowns.delete(id);
    }
    if (
        activeHashes >= MAX_ACTIVE_HASHES ||
        cooldowns.has(userId) ||
        cooldowns.size >= MAX_COOLDOWNS
    ) return null;

    cooldowns.set(userId, now + HASH_COOLDOWN_MS);
    activeHashes++;
    try {
        return await argon2.hash(password, { type: argon2.argon2id });
    } finally {
        activeHashes--;
    }
};
