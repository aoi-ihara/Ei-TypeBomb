import { NextResponse } from "next/server";
import { getEtbUrl } from "@/lib/config/base-url";
import { getMcpIssuer, getMcpResource } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function GET() {
    return NextResponse.json(
        {
            resource: getMcpResource(),
            authorization_servers: [getMcpIssuer()],
            bearer_methods_supported: ["header"],
            scopes_supported: ["etb:rooms"],
            resource_documentation: getEtbUrl("/docs/mcp"),
        },
        {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=300",
            },
        },
    );
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
        },
    });
}
