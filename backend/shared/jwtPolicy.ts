export const ROOM_JWT_POLICY = {
    algorithms: ["ES256"],
    issuer: "ei-typebomb",
    audience: "authenticated",
    requiredClaims: ["exp", "iat"],
};
export const SESSION_JWT_POLICY = {
    algorithms: ["ES256"],
    issuer: "ei-typebomb",
    audience: "ei-typebomb:client-session",
    requiredClaims: ["exp", "iat"],
};
