#!/usr/bin/env node
/**
 * Check the actual OAuth server advertised by an ETB MCP endpoint.
 * No credentials, mutations, or OAuth client registrations are performed.
 */
export async function checkMcpOAuth(endpoint, fetchImpl = fetch) {
    const target = new URL(endpoint);
    if (target.protocol !== "https:" && target.hostname !== "localhost")
        throw new Error("MCP endpoint must use HTTPS");
    const request = async (url) => {
        const response = await fetchImpl(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10000),
            redirect: "error",
        });
        if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
        return response.json();
    };

    const protectedResourceUrl = new URL(
        `/.well-known/oauth-protected-resource${target.pathname}`,
        target.origin,
    ).href;
    const protectedResource = await request(protectedResourceUrl);
    if (protectedResource.resource !== target.href)
        throw new Error("Protected Resource Metadata resource does not match MCP URL");
    const issuer = protectedResource.authorization_servers?.[0];
    if (typeof issuer !== "string") throw new Error("Missing authorization_servers");
    const authServer = new URL(issuer);
    if (authServer.protocol !== "https:")
        throw new Error("Authorization server issuer must use HTTPS");

    // RFC 8414 inserts the well-known segment before an issuer path.
    const oauthDiscovery = new URL(
        `/.well-known/oauth-authorization-server${authServer.pathname.replace(/\\/$/, "")}`,
        authServer.origin,
    ).href;
    const oidcDiscovery = new URL(
        `${authServer.pathname.replace(/\\/$/, "")}/.well-known/openid-configuration`,
        authServer.origin,
    ).href;
    let metadata;
    try {
        metadata = await request(oauthDiscovery);
    } catch {
        metadata = await request(oidcDiscovery);
    }
    if (metadata.issuer !== issuer)
        throw new Error("OAuth discovery issuer mismatch");
    if (typeof metadata.authorization_endpoint !== "string" ||
        typeof metadata.token_endpoint !== "string")
        throw new Error("Incomplete OAuth server discovery");
    const cimd = metadata.client_id_metadata_document_supported === true;
    const dcr = typeof metadata.registration_endpoint === "string" &&
        metadata.registration_endpoint.length > 0;
    return { endpoint: target.href, issuer, cimd, dcr, registrationEndpoint: dcr ? metadata.registration_endpoint : null };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const endpoint = process.argv[2] || "https://ei-typebomb.com/api/mcp";
    checkMcpOAuth(endpoint).then((result) => {
        console.log(`MCP: ${result.endpoint}\nOAuth issuer: ${result.issuer}`);
        console.log(`CIMD: ${result.cimd ? "supported" : "not advertised"}`);
        console.log(`DCR: ${result.dcr ? "advertised" : "not advertised"}`);
        if (!result.cimd && !result.dcr) {
            console.error("OAuth client auto-registration unavailable. Enable Dynamic Client Registration in the shared Supabase Auth OAuth Server settings; do not add a fake discovery endpoint.");
            process.exitCode = 1;
        } else {
            console.log("An automatic client-registration mechanism is advertised. Complete a fresh MCP client connection to test end-to-end OAuth.");
        }
    }).catch((error) => {
        console.error(`MCP OAuth discovery failed: ${error.message}`);
        process.exitCode = 1;
    });
}
