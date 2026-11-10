import assert from "node:assert/strict";
import test from "node:test";
import { checkMcpOAuth } from "../scripts/check-mcp-oauth.mjs";

const endpoint = "https://beta.ei-typebomb.com/api/mcp";
const issuer = "https://sample.supabase.co/auth/v1";
const json = (body) => ({ ok: true, json: async () => body });
function fakeFetch(metadata, protectedResource = {
    resource: endpoint,
    authorization_servers: [issuer],
}) {
    const urls = [];
    const mock = async (url) => {
        urls.push(url);
        return json(url.includes("oauth-protected-resource") ? protectedResource : metadata);
    };
    return { mock, urls };
}
const base = {
    issuer,
    authorization_endpoint: issuer + "/oauth/authorize",
    token_endpoint: issuer + "/oauth/token",
};

test("discovers DCR using RFC 8414 well-known path", async () => {
    const { mock, urls } = fakeFetch({ ...base, registration_endpoint: issuer + "/oauth/register" });
    const result = await checkMcpOAuth(endpoint, mock);
    assert.equal(result.dcr, true);
    assert.equal(result.cimd, false);
    assert.equal(urls[0], "https://beta.ei-typebomb.com/.well-known/oauth-protected-resource/api/mcp");
    assert.equal(urls[1], "https://sample.supabase.co/.well-known/oauth-authorization-server/auth/v1");
});

test("recognizes CIMD separately from DCR", async () => {
    const { mock } = fakeFetch({ ...base, client_id_metadata_document_supported: true });
    const result = await checkMcpOAuth(endpoint, mock);
    assert.equal(result.cimd, true);
    assert.equal(result.dcr, false);
});

test("does not treat an unadvertised registration mechanism as supported", async () => {
    const { mock } = fakeFetch(base);
    const result = await checkMcpOAuth(endpoint, mock);
    assert.equal(result.cimd || result.dcr, false);
});

test("rejects mismatching protected resource", async () => {
    const { mock } = fakeFetch(base, { resource: "https://wrong.example/api/mcp", authorization_servers: [issuer] });
    await assert.rejects(checkMcpOAuth(endpoint, mock), /does not match/);
});

test("rejects issuer mismatch", async () => {
    const { mock } = fakeFetch({ ...base, issuer: "https://attacker.example" });
    await assert.rejects(checkMcpOAuth(endpoint, mock), /issuer mismatch/);
});


test("DCR discovery does not imply resource-bound access tokens", async () => {
    const { mock } = fakeFetch({ ...base, registration_endpoint: issuer + "/oauth/register" });
    const result = await checkMcpOAuth(endpoint, mock);
    assert.equal(result.dcr, true);
    assert.equal(result.resourceAudienceVerified, false);
});
