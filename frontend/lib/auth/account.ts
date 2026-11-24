"use server";
import { createClient } from "@/lib/db/server";
import {
    clearPasswordRecovery,
    hasPasswordRecovery,
    PASSWORD_RESET_PATH,
} from "@/lib/auth/password-recovery";
import { validateEmail, validatePassword } from "@/lib/auth/validator";
import { getEtbUrl } from "@/lib/config/base-url";

export async function submitAccountForm(
    mode: string,
    email: string,
    password: string,
    captchaToken: string,
): Promise<string | null> {
    if (
        ![
            "sign-in",
            "sign-up",
            "recovery",
            "password-link",
            "email",
            "password",
        ].includes(mode)
    )
        return "操作が正しくありません。";
    const recovery = mode === "recovery" || mode === "password-link";
    const publicOperation = ["sign-in", "sign-up", "recovery"].includes(mode);
    const needsEmail = mode !== "password" && mode !== "password-link";
    if (needsEmail) {
        const error = validateEmail(email);
        if (error) return error;
    }
    if (["sign-in", "sign-up", "password"].includes(mode)) {
        const error = validatePassword(password);
        if (error) return error;
    }
    if ((publicOperation || mode === "password-link") && !captchaToken)
        return "ロボットではないことを確認してください。";

    const client = await createClient();
    let targetEmail = needsEmail ? email.trim() : "";
    if (!publicOperation) {
        const { data, error } = await client.auth.getUser();
        if (error || !data.user) return "サインインし直してください。";
        if (mode === "password-link") {
            if (!data.user.email || !data.user.email_confirmed_at)
                return "確認済みのメールアドレスが登録されていません。";
            targetEmail = data.user.email;
        }
    }

    const invalidRecovery =
        "再設定リンクが無効か、有効期限が切れています。再設定メールを送り直してください。";
    if (mode === "password" && !(await hasPasswordRecovery(client.auth)))
        return invalidRecovery;

    const callback = () => getEtbUrl("/auth/confirm");
    const result =
        mode === "sign-in"
            ? await client.auth.signInWithPassword({
                  email: targetEmail,
                  password,
                  options: { captchaToken },
              })
            : mode === "sign-up"
              ? await client.auth.signUp({
                    email: targetEmail,
                    password,
                    options: { captchaToken, emailRedirectTo: callback() },
                })
              : recovery
                ? await client.auth.resetPasswordForEmail(targetEmail, {
                      captchaToken,
                      redirectTo:
                          callback() +
                          `?next=${PASSWORD_RESET_PATH}?update=true`,
                  })
                : mode === "email"
                  ? await client.auth.updateUser(
                        { email: targetEmail },
                        { emailRedirectTo: callback() },
                    )
                  : await client.auth.updateUser({ password });

    if (result.error) {
        const { code, message } = result.error;
        if (
            mode === "sign-in" &&
            (code === "invalid_credentials" ||
                message === "Invalid login credentials")
        )
            return "入力内容が不正確です。";
        if (code === "captcha_failed")
            return "ロボットではないことを確認できませんでした。再度お試しください。";
        if (
            recovery &&
            (code === "over_email_send_rate_limit" ||
                code === "over_request_rate_limit")
        )
            return "メールの送信回数が多すぎます。時間をおいて再度お試しください。";
        if (mode === "password") {
            if (code === "reauthentication_needed") return invalidRecovery;
            if (code === "same_password")
                return "現在と異なるパスワードを入力してください。";
            if (code === "weak_password")
                return "より強力なパスワードを入力してください。";
        }
        return "操作に失敗しました。入力内容や認証、有効期限を確認して再度お試しください。";
    }
    if (mode === "password") await clearPasswordRecovery();
    return null;
}
