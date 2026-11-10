import { getAuthorizationServerMetadata } from "@/lib/mcp/authorization-server/config";

export const dynamic = "force-dynamic";
export function GET() {
    try {
        return Response.json(getAuthorizationServerMetadata(), {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
            },
        });
    } catch {
        return Response.json(
            { error: "temporarily_unavailable" },
            { status: 503 },
        );
    }
}
