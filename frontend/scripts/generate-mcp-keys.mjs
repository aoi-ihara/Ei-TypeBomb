#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { generateKeyPair, exportJWK } from "jose";
const destination = process.argv[2];
if (!destination)
  throw new Error(
    "Pass a private output file path; existing files are never overwritten",
  );
const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const key = {
  ...(await exportJWK(privateKey)),
  kid: randomBytes(12).toString("base64url"),
  alg: "ES256",
  use: "sig",
};
writeFileSync(
  destination,
  [
    `ETB_MCP_STORAGE_KEY=${randomBytes(32).toString("base64url")}`,
    `ETB_MCP_COOKIE_KEYS=${randomBytes(48).toString("base64url")}`,
    `ETB_MCP_SIGNING_JWKS='${JSON.stringify({ keys: [key] })}'`,
    "",
  ].join("\n"),
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Saved MCP keys to the requested private file. Keep it outside source control.",
);
