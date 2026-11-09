import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/db/server";
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
        const client = await createClient();
        const code = params.get("code");
        const hash = params.get("token_hash");
        const type = params.get("type");
        const result = code
            ? await client.auth.exchangeCodeForSession(code)
            : hash &&
                (type === "signup" ||
                    type === "recovery" ||
                    type === "email_change" ||
                    type === "email")
              ? await client.auth.verifyOtp({ token_hash: hash, type })
              : null;
        if (result && !result.error) {
            const reset =
                type === "recovery" ||
                params.get("next") === "/sign-in/reset-password?update=true";
            return NextResponse.redirect(
                new URL(
                    reset ? "/sign-in/reset-password?update=true" : "/account",
                    request.url,
                ),
            );
        }
    return NextResponse.redirect(
        new URL("/sign-in/reset-password?error=invalid-link", request.url),
    );
}
