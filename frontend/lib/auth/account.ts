"use server";
import { createClient } from "@/lib/db/server";
import { validateEmail, validatePassword } from "@/lib/auth/validator";
import { getEtbUrl } from "@/lib/config/base-url";

const reauthenticationSendError = (code?: string) =>
    code === "over_email_send_rate_limit" || code === "over_request_rate_limit"
        ? "確認コードの送信回数が多すぎます。時間をおいて再度お試しください。"
        : "確認コードを送信できませんでした。時間をおいて再度お試しください。";

export async function requestPasswordReauthentication() {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return "サインインし直してください。";
    const { error: sendError } = await client.auth.reauthenticate();
    return sendError ? reauthenticationSendError(sendError.code) : null;
}

export async function submitAccountForm(
    mode: string,
    email: string,
    password: string,
    captchaToken: string,
    nonce?: string,
): Promise<string | { reauthenticationRequired: true } | null> {
    if (!["sign-in", "sign-up", "recovery", "email", "password"].includes(mode))
        return "操作が正しくありません。";
    const validation =
        mode === "password" ? validatePassword(password) : validateEmail(email);
    if (validation) return validation;
    if (["sign-in", "sign-up"].includes(mode)) {
        const error = validatePassword(password);
        if (error) return error;
    }
    if (
        mode === "password" &&
        nonce !== undefined &&
        !/^\d{6}$/.test(nonce.trim())
    )
        return "確認コードは6桁の数字で入力してください。";
    const publicOperation = ["sign-in", "sign-up", "recovery"].includes(mode);
    if (publicOperation && !captchaToken)
        return "ロボットではないことを確認してください。";
    const client = await createClient();
    if (!publicOperation) {
        const { data, error } = await client.auth.getUser();
        if (error || !data.user) return "サインインし直してください。";
    }
    const callback = () => getEtbUrl("/auth/confirm");
    const result =
        mode === "sign-in"
            ? await client.auth.signInWithPassword({
                  email: email.trim(),
                  password,
                  options: { captchaToken },
              })
            : mode === "sign-up"
              ? await client.auth.signUp({
                    email: email.trim(),
                    password,
                    options: { captchaToken, emailRedirectTo: callback() },
                })
              : mode === "recovery"
                ? await client.auth.resetPasswordForEmail(email.trim(), {
                      captchaToken,
                      redirectTo:
                          callback() +
                          "?next=/sign-in/reset-password?update=true",
                  })
                : await client.auth.updateUser(
                      mode === "email"
                          ? { email: email.trim() }
                          : {
                                password,
                                ...(nonce !== undefined ? { nonce: nonce.trim() } : {}),
                            },
                      { emailRedirectTo: callback() },
                  );
    if (result.error) {
        if (
            mode === "sign-in" &&
            (result.error.code === "invalid_credentials" ||
                result.error.message === "Invalid login credentials")
        ) {
            return "入力内容が不正確です。";
        }
        if (mode === "password") {
            if (result.error.code === "reauthentication_needed") {
                if (nonce !== undefined)
                    return "確認コードが無効か、有効期限が切れています。コードを再送信してください。";
                const { error: sendError } = await client.auth.reauthenticate();
                return sendError
                    ? reauthenticationSendError(sendError.code)
                    : { reauthenticationRequired: true };
            }
            if (
                result.error.code === "reauthentication_not_valid" ||
                result.error.code === "reauth_nonce_missing" ||
                result.error.code === "otp_expired"
            ) {
                return "確認コードが正しくないか、有効期限が切れています。";
            }
            if (result.error.code === "same_password") {
                return "現在と異なるパスワードを入力してください。";
            }
            if (result.error.code === "weak_password") {
                return "より強力なパスワードを入力してください。";
            }
        }
        return "操作に失敗しました。入力内容や認証、有効期限を確認して再度お試しください。";
    }
    return null;
}
