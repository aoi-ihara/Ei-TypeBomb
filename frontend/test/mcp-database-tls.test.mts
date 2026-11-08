import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { X509Certificate } from "node:crypto";
import * as tls from "node:tls";
import { Client, type PoolConfig } from "pg";
import { getMcpDatabasePoolConfig } from "../lib/mcp/authorization-server/database-config";
import { SUPABASE_DATABASE_CA } from "../lib/mcp/authorization-server/supabase-ca";
import {
  logOAuthServerFailure,
  oauthFailureCode,
} from "../lib/mcp/authorization-server/diagnostics";

const exec = promisify(execFile);
const pooler =
  "postgresql://test:unused@aws-1-ap-south-1.pooler.supabase.com:6543/postgres";
function driverTls(config: PoolConfig): tls.ConnectionOptions {
  // Exercise pg's final URL parsing, where sslmode used to overwrite an
  // explicitly supplied CA. The pinned pg version exposes these parameters.
  return (
    new Client(config) as unknown as {
      connectionParameters: { ssl: tls.ConnectionOptions };
    }
  ).connectionParameters.ssl;
}

test("Supabase pooler receives the dashboard CA after pg parses the URL", () => {
  const certificate = new X509Certificate(SUPABASE_DATABASE_CA);
  assert.equal(
    certificate.fingerprint256.replaceAll(":", ""),
    "807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA",
  );
  assert.ok(certificate.ca);
  assert.ok(certificate.verify(certificate.publicKey));
  const ssl = driverTls(
    getMcpDatabasePoolConfig(pooler + "?sslmode=verify-full"),
  );
  assert.equal(ssl.ca, SUPABASE_DATABASE_CA);
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.checkServerIdentity, undefined);
  const direct = driverTls(
    getMcpDatabasePoolConfig(
      "postgresql://test:unused@db.exampleproject.supabase.co/postgres?sslmode=verify-full",
    ),
  );
  assert.equal(direct.ca, SUPABASE_DATABASE_CA);
});

test("remote database TLS cannot be weakened through conflicting URL options", () => {
  for (const query of [
    "",
    "?sslmode=require",
    "?sslmode=no-verify",
    "?sslmode=disable",
    "?sslmode=verify-full&sslmode=no-verify",
    "?sslmode=verify-full&ssl=0",
    "?sslmode=verify-full&uselibpqcompat=true",
    "?sslmode=verify-full&sslkey=key.pem",
  ]) {
    assert.throws(() => getMcpDatabasePoolConfig(pooler + query), {
      code: "MCP_DATABASE_TLS_REQUIRED",
    });
  }
  const other = driverTls(
    getMcpDatabasePoolConfig(
      "postgresql://user:unused@unrelated.example/db?sslmode=verify-full",
    ),
  );
  assert.equal(other.ca, undefined);
});

test("real TLS verifies trusted chain and hostname and rejects an unrelated CA", async () => {
  const directory = await mkdtemp(join(tmpdir(), "etb-mcp-tls-"));
  const file = (name: string) => join(directory, name);
  try {
    await exec("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      file("ca.key"),
      "-out",
      file("ca.crt"),
      "-subj",
      "/CN=ETB temporary test CA",
      "-days",
      "1",
    ]);
    await exec("openssl", [
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      file("server.key"),
      "-out",
      file("server.csr"),
      "-subj",
      "/CN=dbtest.local",
    ]);
    await writeFile(
      file("server.ext"),
      "subjectAltName=DNS:dbtest.local\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n",
    );
    await exec("openssl", [
      "x509",
      "-req",
      "-in",
      file("server.csr"),
      "-CA",
      file("ca.crt"),
      "-CAkey",
      file("ca.key"),
      "-CAcreateserial",
      "-out",
      file("server.crt"),
      "-days",
      "1",
      "-extfile",
      file("server.ext"),
    ]);
    const server = tls.createServer(
      {
        key: await readFile(file("server.key")),
        cert: await readFile(file("server.crt")),
      },
      (socket) => socket.end(),
    );
    server.on("tlsClientError", () => {});
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    function connect(hostname: string, ssl: tls.ConnectionOptions) {
      return new Promise<void>((resolve, reject) => {
        const socket = tls.connect(
          { ...ssl, host: "127.0.0.1", port, servername: hostname },
          () => {
            const verified = socket.authorized;
            socket.end();
            if (verified) resolve();
            else reject(new Error("TLS peer not authorized"));
          },
        );
        socket.on("error", (error) => {
          socket.destroy();
          reject(error);
        });
      });
    }
    try {
      const url = new URL(
        "postgresql://user:unused@dbtest.local/db?sslmode=verify-full",
      );
      url.searchParams.set("sslrootcert", file("ca.crt"));
      const trusted = driverTls(getMcpDatabasePoolConfig(url.href));
      await connect("dbtest.local", trusted);
      await assert.rejects(connect("wrong-host.local", trusted), {
        code: "ERR_TLS_CERT_ALTNAME_INVALID",
      });
      const unrelatedCA = driverTls(
        getMcpDatabasePoolConfig(pooler + "?sslmode=verify-full"),
      );
      await assert.rejects(connect("dbtest.local", unrelatedCA));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("diagnostics expose only recognized error codes, never credentials or exception text", (t) => {
  const logger = t.mock.method(console, "error", () => {});
  const error = {
    code: "SELF_SIGNED_CERT_IN_CHAIN",
    message: "postgresql://user:secret@host/db",
    detail: "private OAuth request",
  };
  logOAuthServerFailure(error);
  assert.deepEqual(logger.mock.calls[0].arguments, [
    "[MCP OAuth] request could not be completed",
    { code: "SELF_SIGNED_CERT_IN_CHAIN" },
  ]);
  assert.equal(
    oauthFailureCode({ code: "postgresql://user:secret@host/db" }),
    "operation_failed",
  );
  assert.equal(oauthFailureCode({ code: "28P01" }), "28P01");
});
