import { NextResponse } from "next/server";
import {
    MCP_AUTHORIZATION_SERVER,
    MCP_RESOURCE,
} from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function GET() {
    return NextResponse.json(
        {
            resource: MCP_RESOURCE,
            authorization_servers: [MCP_AUTHORIZATION_SERVER],
            bearer_methods_supported: ["header"],
            resource_documentation: "https://ei-typebomb.com/docs/mcp",
        },
        {
            headers: {
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
