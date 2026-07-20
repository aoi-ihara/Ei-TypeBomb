"use server";

import { createClient } from "@/lib/db/server";
import { validateEmail, validatePassword } from "@/lib/auth/validator";
import { redirect } from "next/navigation";

export const signIn = async (
    email: string,
    password: string,
    turnstileToken: string,
) => {
    if (!turnstileToken) return "No Turnstile token provided";

    const emailError = validateEmail(email);
    const passwordError = validatePassword(password);
    if (emailError) return "Information is wrong";
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
        return error.message;
    }

    redirect("/");
};
