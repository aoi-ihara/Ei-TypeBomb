"use server";
import { createClient } from "@/lib/db/server";
import { validateEmail, validatePassword } from "@/lib/auth/validator";
import { getEtbUrl } from "@/lib/config/base-url";

export async function submitAccountForm(
    mode: string,
    email: string,
    password: string,
    captchaToken: string,
) {
    if (!["sign-in", "sign-up", "recovery", "email", "password"].includes(mode))
        return "操作が正しくありません。";
    const validation =
        mode === "password" ? validatePassword(password) : validateEmail(email);
    if (validation) return validation;
    if (["sign-in", "sign-up"].includes(mode)) {
        const error = validatePassword(password);
        if (error) return error;
    }
    const publicOperation = ["sign-in", "sign-up", "recovery"].includes(mode);
    if (publicOperation && !captchaToken)
        return "ロボットではないことを確認してください。";
    const client = await createClient();
    if (!publicOperation) {
        const { data, error } = await client.auth.getUser();
        if (error || !data.user) return "ログインし直してください。";
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
                      mode === "email" ? { email: email.trim() } : { password },
                      { emailRedirectTo: callback() },
                  );
    return result.error
        ? "操作に失敗しました。入力内容や認証、有効期限を確認して再度お試しください。"
        : null;
}
