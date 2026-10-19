import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, SignJWT, jwtVerify } from "jose";
import { ROOM_JWT_POLICY, SESSION_JWT_POLICY } from "../../shared/jwtPolicy";

test("room/session signatures require expiry, issuer and separate audiences", async () => {
    const keys = await generateKeyPair("ES256");
    const other = await generateKeyPair("ES256");
    const sign = (audience: string, issuer = "ei-typebomb", expires = "1h") =>
        new SignJWT({ role: "client_session" })
            .setProtectedHeader({ alg: "ES256", kid: "key" })
            .setIssuer(issuer)
            .setAudience(audience)
            .setIssuedAt()
            .setExpirationTime(expires)
            .sign(keys.privateKey);
    const session = await sign("ei-typebomb:client-session");
    await jwtVerify(session, keys.publicKey, SESSION_JWT_POLICY);
    await assert.rejects(jwtVerify(session, keys.publicKey, ROOM_JWT_POLICY));
    await assert.rejects(
        jwtVerify(await sign("other"), keys.publicKey, SESSION_JWT_POLICY),
    );
    await assert.rejects(
        jwtVerify(
            await sign("ei-typebomb:client-session", "other"),
            keys.publicKey,
            SESSION_JWT_POLICY,
        ),
    );
    await assert.rejects(
        jwtVerify(
            await sign("ei-typebomb:client-session", "ei-typebomb", "-1s"),
            keys.publicKey,
            SESSION_JWT_POLICY,
        ),
    );
    await assert.rejects(
        jwtVerify(session, other.publicKey, SESSION_JWT_POLICY),
    );
    const noExpiry = await new SignJWT({})
        .setProtectedHeader({ alg: "ES256" })
        .setIssuer("ei-typebomb")
        .setAudience("ei-typebomb:client-session")
        .setIssuedAt()
        .sign(keys.privateKey);
    await assert.rejects(
        jwtVerify(noExpiry, keys.publicKey, SESSION_JWT_POLICY),
    );
});
