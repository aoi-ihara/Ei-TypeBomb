import { createOAuthHandler } from "@/lib/mcp/authorization-server/http";

// oidc-provider consumes real Node HTTP streams. Pages API routes provide
// IncomingMessage/ServerResponse on Vercel without an emulated stream bridge.
export const config = { api: { bodyParser: false, externalResolver: true } };
export default createOAuthHandler();
