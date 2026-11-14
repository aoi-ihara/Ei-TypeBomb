import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { prepareItemReadings } from "../lib/room/readings";
import type { Item } from "../type";

export async function backfill(db: pg.Client, dryRun: boolean, pageSize = 100) {
    const stats = { scanned: 0, changed: 0, written: 0, conflicts: 0, failed: 0 };
    let cursor: string | null = null;
    for (;;) {
        const { rows }: { rows: { id: string; items: Item[]; edit_version: string }[] } =
            await db.query(`SELECT id, items, edit_version FROM public.ei_typebomb_rooms
                WHERE ($1::uuid IS NULL OR id > $1) ORDER BY id LIMIT $2`, [cursor, pageSize]);
        if (!rows.length) break;
        for (const room of rows) {
            stats.scanned++;
            try {
                let failed = false;
                const items = await prepareItemReadings(room.items, room.items, undefined, () => { failed = true; });
                if (failed) throw Error("reading generation failed");
                if (isDeepStrictEqual(items, room.items)) continue;
                stats.changed++;
                if (dryRun) continue;
                const result = await db.query(`UPDATE public.ei_typebomb_rooms SET items = $1::jsonb
                    WHERE id = $2 AND edit_version = $3`, [JSON.stringify(items), room.id, room.edit_version]);
                if (result.rowCount) stats.written++;
                else {
                    stats.conflicts++;
                    console.warn("version conflict", room.id);
                }
            } catch (error) {
                stats.failed++;
                console.error("room failed", room.id, error instanceof Error ? error.message : "unknown error");
            }
        }
        cursor = rows[rows.length - 1].id;
        console.log({ dryRun, ...stats });
        if (rows.length < pageSize) break;
    }
    return stats;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !["--dry-run", "--apply"].includes(args[0])) {
        throw Error("Specify --dry-run or --apply");
    }
    if (!process.env.DATABASE_URL) throw Error("Set DATABASE_URL to the target PostgreSQL connection string");
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
        const stats = await backfill(db, args[0] === "--dry-run");
        console.log("finished", stats);
        if (stats.failed || stats.conflicts) process.exitCode = 1;
    } finally {
        await db.end();
    }
}
