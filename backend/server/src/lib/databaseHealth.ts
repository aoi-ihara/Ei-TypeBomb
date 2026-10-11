import type { Pool } from "pg";

// Keep this below the client's seven-second health-check budget. PostgreSQL
// enforces this on the server, so a blocked probe is cancelled and releases
// its pool slot instead of continuing after the client has given up.
export const DATABASE_HEALTH_TIMEOUT_MS = 6_000;

export const probeRoomDatabase = async (database: Pool): Promise<void> => {
    const client = await database.connect();

    try {
        await client.query("BEGIN");
        await client.query(
            `SET LOCAL statement_timeout = ${DATABASE_HEALTH_TIMEOUT_MS}`,
        );
        await client.query("SELECT id FROM public.ei_typebomb_rooms LIMIT 1");
    } finally {
        // End the transaction before returning the connection so the local
        // timeout and any aborted-transaction state cannot leak to its next user.
        try {
            await client.query("ROLLBACK");
        } finally {
            client.release();
        }
    }
};
