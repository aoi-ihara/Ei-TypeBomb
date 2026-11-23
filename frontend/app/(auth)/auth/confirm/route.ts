import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/db/server";
import { grantPasswordRecovery, PASSWORD_RESET_PATH } from "@/lib/auth/password-recovery";

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const client = await createClient();
    const code = params.get("code");
    const hash = params.get("token_hash");
    const type = params.get("type");

    const validHashType =
        type === "signup" || type === "recovery" || type === "email_change" || type === "email";
    const result = code
        ? await client.auth.exchangeCodeForSession(code)
        : hash && validHashType
          ? await client.auth.verifyOtp({ token_hash: hash, type })
          : null;

    if (result && !result.error) {
        const reset = code
            ? params.get("next") === `${PASSWORD_RESET_PATH}?update=true`
            : type === "recovery";
        if (!reset)
            return NextResponse.redirect(new URL("/account", request.url));
        // The token-hash flow uses Supabase's OTP method after verifying
        // the specific recovery token.
        if (
            result.data.session &&
            await grantPasswordRecovery(client.auth, result.data.session.access_token, code ? "recovery" : "otp")
        )
            return NextResponse.redirect(new URL(`${PASSWORD_RESET_PATH}?update=true`, request.url));
    }

    return NextResponse.redirect(new URL(`${PASSWORD_RESET_PATH}?error=invalid-link`, request.url));
}
