"use server";

import { createClient } from "@/lib/db/server";
import { validateEmail, validatePassword } from "@/lib/auth/validator";
import { redirect } from "next/navigation";

export const signIn = async (
    email: string,
    password: string,
    turnstileToken: string,
) => {
    if (!turnstileToken) return "ロボットではないことを確認してください。";

    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);
    if (emailError) return "入力内容が正しくありません。";
    if (passwordError) return passwordError;

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: {
            captchaToken: turnstileToken,
        },
    });

    if (error) {
        console.error(error);
        return "ログインできませんでした。メールアドレス、パスワード、認証を確認して再度お試しください。";
    }

    redirect("/");
};
