import { AsyncLocalStorage } from "node:async_hooks";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { getAuthorizationServerConfig } from "./config";

type Payload = Record<string, unknown>;
type Stored = { payload: string; consumed: number | null };
const connection = new AsyncLocalStorage<PoolClient>();
let pool: Pool | undefined;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");

function database() {
  if (!pool) {
    const { databaseUrl } = getAuthorizationServerConfig();
    // TLS configuration belongs in the URL (sslmode=verify-full). Never
    // disable certificate verification for a hosted database.
    const url = new URL(databaseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!local && url.searchParams.get("sslmode") !== "verify-full") {
      throw new Error("MCP database requires sslmode=verify-full");
    }
    pool = new Pool({
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      query_timeout: 10000,
    });
  }
  return pool;
}

function encode(model: string, id: string, payload: Payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    getAuthorizationServerConfig().encryptionKey,
    iv,
  );
  cipher.setAAD(Buffer.from(`${model}:${id}`));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}

function decode(model: string, id: string, row: Stored): Payload {
  const bytes = Buffer.from(row.payload, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getAuthorizationServerConfig().encryptionKey,
    bytes.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from(`${model}:${id}`));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const payload = JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString(),
  );
  if (row.consumed) payload.consumed = Number(row.consumed);
  return payload;
}

async function query(sql: string, values: unknown[]) {
  return (connection.getStore() ?? database()).query(sql, values);
}

/** Serialize OAuth mutations across Vercel instances, including code redemption,
 * refresh rotation and grant revocation. A transaction-scoped lock also works
 * with Supabase transaction pooling. The HTTP layer releases responses only
 * after commit. Handled protocol errors commit replay/revocation markers.
 */
export async function withOAuthLock<T>(run: () => Promise<T>): Promise<T> {
  const client = await database().connect();
  const issuer = getAuthorizationServerConfig().issuer;
  let broken = false;
  try {
    await client.query("begin");
    await client.query("set local statement_timeout = '10s'");
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [issuer],
    );
    const result = await connection.run(client, run);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

export class OAuthStore {
  constructor(private model: string) {}
  private get issuer() {
    return getAuthorizationServerConfig().issuer;
  }

  async upsert(id: string, payload: Payload, expiresIn?: number) {
    const key = digest(id);
    await query(
      `insert into etb_mcp_oauth.models
            (issuer, model, id, payload, expires_at, uid, user_code, grant_id, account_id)
            values ($1,$2,$3,$4,now()+$5*interval '1 second',$6,$7,$8,$9)
            on conflict (issuer,model,id) do update set payload=excluded.payload,
            expires_at=excluded.expires_at, uid=excluded.uid, user_code=excluded.user_code,
            grant_id=excluded.grant_id, account_id=excluded.account_id`,
      [
        this.issuer,
        this.model,
        key,
        encode(this.model, key, payload),
        expiresIn ?? 90 * 86400,
        typeof payload.uid === "string" ? digest(payload.uid) : null,
        typeof payload.userCode === "string" ? digest(payload.userCode) : null,
        typeof payload.grantId === "string" ? digest(payload.grantId) : null,
        typeof payload.accountId === "string"
          ? digest(payload.accountId)
          : null,
      ],
    );
  }

  private async lookup(column: "id" | "uid" | "user_code", value: string) {
    const { rows } = await query(
      `select id, payload, consumed from etb_mcp_oauth.models
            where issuer=$1 and model=$2 and ${column}=$3 and expires_at>now()`,
      [this.issuer, this.model, digest(value)],
    );
    return rows[0] ? decode(this.model, rows[0].id, rows[0]) : undefined;
  }
  find(id: string) {
    return this.lookup("id", id);
  }
  findByUid(uid: string) {
    return this.lookup("uid", uid);
  }
  findByUserCode(code: string) {
    return this.lookup("user_code", code);
  }
  async destroy(id: string) {
    await query(
      "delete from etb_mcp_oauth.models where issuer=$1 and model=$2 and id=$3",
      [this.issuer, this.model, digest(id)],
    );
  }
  async consume(id: string) {
    const result = await query(
      `update etb_mcp_oauth.models
            set consumed=extract(epoch from now())::bigint where issuer=$1 and model=$2
            and id=$3 and consumed is null and expires_at>now() returning id`,
      [this.issuer, this.model, digest(id)],
    );
    if (result.rowCount !== 1)
      throw new Error("OAuth artifact already consumed or expired");
  }
  async revokeByGrantId(grantId: string) {
    await query(
      "delete from etb_mcp_oauth.models where issuer=$1 and model=$2 and grant_id=$3",
      [this.issuer, this.model, digest(grantId)],
    );
  }
  async forAccount(userId: string) {
    const { rows } = await query(
      `select id, payload, consumed from etb_mcp_oauth.models
            where issuer=$1 and model=$2 and account_id=$3 and expires_at>now()`,
      [this.issuer, this.model, digest(userId)],
    );
    return rows.map((row) => decode(this.model, row.id, row));
  }
}

export async function revokeGrant(id: string) {
  await query(
    `delete from etb_mcp_oauth.models where issuer=$1 and
        (grant_id=$2 or (model='Grant' and id=$2))`,
    [getAuthorizationServerConfig().issuer, digest(id)],
  );
}

export async function rateLimit(bucket: string, limit: number) {
  const { rows } = await query(
    `insert into etb_mcp_oauth.rate_limits (issuer,bucket,window_start,count)
        values ($1,$2,date_trunc('minute',now()),1)
        on conflict (issuer,bucket) do update set
        count=case when etb_mcp_oauth.rate_limits.window_start=excluded.window_start
            then etb_mcp_oauth.rate_limits.count+1 else 1 end,
        window_start=excluded.window_start returning count`,
    [getAuthorizationServerConfig().issuer, digest(bucket)],
  );
  return rows[0].count <= limit;
}

export async function closeOAuthDatabase() {
  await pool?.end();
  pool = undefined;
}
