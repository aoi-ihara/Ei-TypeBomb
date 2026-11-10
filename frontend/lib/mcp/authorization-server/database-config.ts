import type { PoolConfig } from "pg";
import { SUPABASE_DATABASE_CA } from "./supabase-ca";

function invalidTls(): never {
    throw Object.assign(new Error("MCP database requires verified TLS"), {
        code: "MCP_DATABASE_TLS_REQUIRED",
    });
}

export function getMcpDatabasePoolConfig(databaseUrl: string): PoolConfig {
    const url = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) invalidTls();
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const config: PoolConfig = {
        connectionString: databaseUrl,
        max: 2,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        query_timeout: 10000,
    };
    if (local) return config;

    if (
        url.searchParams.getAll("sslmode").length !== 1 ||
        url.searchParams.get("sslmode") !== "verify-full" ||
        url.searchParams.getAll("sslrootcert").length > 1
    )
        invalidTls();
    // Prevent connection-string SSL settings from overriding the explicit TLS
    // policy. pg reparses these options and replaces PoolConfig.ssl wholesale.
    for (const name of [
        "ssl",
        "sslcert",
        "sslkey",
        "sslpassword",
        "uselibpqcompat",
        "sslnegotiation",
    ]) {
        if (url.searchParams.has(name)) invalidTls();
    }
    const supabase =
        /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) ||
        /^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname);
    if (supabase && !url.searchParams.has("sslrootcert")) {
        // The pooler's private CA is absent from Node's default trust store. Bundle
        // the official public root so Vercel needs no filesystem path or extra env.
        // Remove sslmode only after enforcing verify-full above: otherwise pg's
        // URL parser drops the supplied CA. Node still verifies chain AND hostname.
        url.searchParams.delete("sslmode");
        config.connectionString = url.href;
        config.ssl = { ca: SUPABASE_DATABASE_CA, rejectUnauthorized: true };
    }
    // Other database providers and explicit sslrootcert paths retain pg's
    // verify-full parsing and normal hostname verification.
    return config;
}
