"use client";
import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { Turnstile } from "@marsidev/react-turnstile";
import { submitAccountForm } from "@/lib/auth/account";

type Mode = "sign-in" | "sign-up" | "recovery" | "email" | "password";
export default function AuthForm({ mode }: { mode: Mode }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [token, setToken] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const lock = useRef(false);
    const captcha =
        useRef<import("@marsidev/react-turnstile").TurnstileInstance>(null);
    const publicOperation = ["sign-in", "sign-up", "recovery"].includes(mode);
    const needsPassword = ["sign-in", "sign-up", "password"].includes(mode);
    return (
        <form
            className="flex w-full flex-col gap-4"
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
                    setError("パスワードが一致しません。");
                    return;
                }
                lock.current = true;
                setBusy(true);
                try {
                    const result = await submitAccountForm(
                        mode,
                        email,
                        password,
                        token,
                    );
                    if (result) setError(result);
                    else if (mode === "sign-in")
                        window.location.assign("/account");
                    else {
                        setPassword("");
                        setConfirmation("");
                        setMessage(
                            mode === "password"
                                ? "パスワードを変更しました。"
                                : "メールをご確認ください。対象のアカウントがある場合は確認メールが届きます。",
                        );
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
            {mode !== "password" && (
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
            {needsPassword && (
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
            {needsPassword && mode !== "sign-in" && (
                <Input
                    label="パスワード（確認）"
                    value={confirmation}
                    type="password"
                    autoComplete="new-password"
                    disabled={busy}
                    onChange={(e) => setConfirmation(e.target.value)}
                />
            )}
            {publicOperation &&
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
                    <p role="alert">認証の設定が不足しています。</p>
                ))}
            {error && (
                <p role="alert" className="text-red-500">
                    {error}
                </p>
            )}
            {message && <p role="status">{message}</p>}
            <Button
                type="submit"
                className="w-full"
                variant="primary"
                loading={busy}
                disabled={publicOperation && !token}
            >
                {
                    {
                        "sign-in": "ログイン",
                        "sign-up": "アカウント作成",
                        recovery: "再設定メールを送信",
                        email: "確認メールを送信",
                        password: "パスワードを変更",
                    }[mode]
                }
            </Button>
        </form>
    );
}
