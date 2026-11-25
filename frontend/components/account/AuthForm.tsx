"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { Turnstile } from "@marsidev/react-turnstile";
import { submitAccountForm } from "@/lib/auth/account";
import { getSignInReturnPath } from "@/lib/auth/return-path";

type Mode = "sign-in" | "sign-up" | "recovery" | "password-link" | "email" | "password";
export default function AuthForm({
    mode,
}: {
    mode: Mode;
}) {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [passwordUpdated, setPasswordUpdated] = useState(false);
    const [token, setToken] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const lock = useRef(false);
    const captcha =
        useRef<import("@marsidev/react-turnstile").TurnstileInstance>(null);
    const needsCaptcha = ["sign-in", "sign-up", "recovery", "password-link"].includes(mode);
    const needsPassword = ["sign-in", "sign-up", "password"].includes(mode);

    return (
        <form
            className="flex w-full flex-col gap-4 items-center"
            onSubmit={async (event) => {
                event.preventDefault();
                if (lock.current) return;
                setError("");
                setMessage("");
                if (
                    mode !== "sign-in" &&
                    needsPassword &&
                    password !== confirmation
                ) {
                    setError("入力内容が不正確です。");
                    return;
                }
                lock.current = true;
                setBusy(true);
                try {
                    const returnTo =
                        mode === "sign-in"
                            ? getSignInReturnPath(window.location.search)
                            : "/mine";
                    const result = await submitAccountForm(
                        mode,
                        email,
                        password,
                        token,
                    );
                    if (result) setError(result);
                    else if (mode === "sign-in")
                        window.location.assign(returnTo);
                    else if (mode === "sign-up")
                        router.replace("/sign-up/check-email");
                    else {
                        setPassword("");
                        setConfirmation("");
                        if (mode === "password") setPasswordUpdated(true);
                        setMessage(
                            mode === "password"
                                ? "パスワードを変更しました。"
                                : mode === "password-link"
                                  ? "パスワードの再設定リンクを送信しました。このブラウザでメールのリンクを開いてください。"
                                  : "メールをご確認ください。対象のアカウントがある場合は確認メールが届きます。",
                        );
                        // Refresh the verified session if email changes immediately.
                        // Pending changes stay unchanged until /auth/confirm redirects to /account.
                        if (mode === "email") router.refresh();
                    }
                } catch {
                    setError("通信に失敗しました。再度お試しください。");
                } finally {
                    lock.current = false;
                    setBusy(false);
                    setToken("");
                    captcha.current?.reset();
                }
            }}
        >
            {mode === "password-link" && !message && (
                <p>登録済みのメールアドレスに、パスワードの再設定リンクを送信します。</p>
            )}
            {mode !== "password" && mode !== "password-link" && (
                <Input
                    label={
                        mode === "email"
                            ? "新しいメールアドレス"
                            : "メールアドレス"
                    }
                    value={email}
                    type="email"
                    autoComplete="email"
                    font="mono"
                    disabled={busy}
                    onChange={(e) => setEmail(e.target.value)}
                />
            )}
            {needsPassword && !passwordUpdated && (
                <Input
                    label="パスワード"
                    value={password}
                    type="password"
                    autoComplete={
                        mode === "sign-in" ? "current-password" : "new-password"
                    }
                    disabled={busy}
                    onChange={(e) => setPassword(e.target.value)}
                />
            )}
            {needsPassword && mode !== "sign-in" && !passwordUpdated && (
                <Input
                    label="パスワードの確認"
                    value={confirmation}
                    type="password"
                    autoComplete="new-password"
                    disabled={busy}
                    onChange={(e) => setConfirmation(e.target.value)}
                />
            )}
            {needsCaptcha &&
                (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? (
                    <Turnstile
                        ref={captcha}
                        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                        options={{ language: "ja" }}
                        onSuccess={setToken}
                        onExpire={() => setToken("")}
                        onError={() => {
                            setToken("");
                            setError("認証を再試行してください。");
                        }}
                    />
                ) : (
                    <p role="alert" data-cursor="text">
                        認証の設定が不足しています。
                    </p>
                ))}
            {error && (
                <p data-cursor="text" role="alert" className="text-red-500">
                    {error}
                </p>
            )}
            {message && <p role="status">{message}</p>}
            {!passwordUpdated && (
                <Button
                    type="submit"
                    className="w-full"
                    variant="primary"
                    iconName={{
                        "sign-in": "logIn",
                        "sign-up": "userRoundPlus",
                        recovery: "arrowRight",
                        "password-link": "mail",
                        email: "arrowRight",
                        password: "rotateCcw",
                    }[mode]}
                    loading={busy}
                    disabled={busy || (needsCaptcha && !token)}
                >
                    {{
                        "sign-in": "サインイン",
                        "sign-up": "サインアップ",
                        recovery: "続ける",
                        "password-link": message ? "リンクを再送信" : "リンクを送信",
                        email: "続ける",
                        password: "変更",
                    }[mode]}
                </Button>
            )}
        </form>
    );
}
