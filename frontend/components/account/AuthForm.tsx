"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { Turnstile } from "@marsidev/react-turnstile";
import {
    requestPasswordReauthentication,
    submitAccountForm,
} from "@/lib/auth/account";
import { safeReturnPath } from "@/lib/auth/return-path";

type Mode = "sign-in" | "sign-up" | "recovery" | "email" | "password";
export default function AuthForm({
    mode,
    next,
}: {
    mode: Mode;
    next?: string;
}) {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [nonce, setNonce] = useState("");
    const [reauthenticationRequired, setReauthenticationRequired] =
        useState(false);
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
                    const result = await submitAccountForm(
                        mode,
                        email,
                        password,
                        token,
                        mode === "password" && reauthenticationRequired
                            ? nonce
                            : undefined,
                    );
                    if (result && typeof result === "object") {
                        setReauthenticationRequired(true);
                        setNonce("");
                        setMessage(
                            "本人確認コードを送信しました。メールに届いた6桁のコードを入力してください。",
                        );
                    } else if (result) setError(result);
                    else if (mode === "sign-in")
                        window.location.assign(
                            next ? safeReturnPath(next) : "/mine",
                        );
                    else if (mode === "sign-up")
                        router.replace("/sign-up/check-email");
                    else {
                        setPassword("");
                        setConfirmation("");
                        setNonce("");
                        setReauthenticationRequired(false);
                        setMessage(
                            mode === "password"
                                ? "パスワードを変更しました。"
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
                    label="パスワードの確認"
                    value={confirmation}
                    type="password"
                    autoComplete="new-password"
                    disabled={busy}
                    onChange={(e) => setConfirmation(e.target.value)}
                />
            )}
            {mode === "password" && reauthenticationRequired && (
                <>
                    <Input
                        label="確認コード"
                        value={nonce}
                        type="text"
                        autoComplete="one-time-code"
                        font="mono"
                        disabled={busy}
                        onChange={(e) =>
                            setNonce(e.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                    />
                    <Button
                        type="button"
                        variant="text"
                        disabled={busy}
                        onClick={async () => {
                            if (lock.current) return;
                            lock.current = true;
                            setBusy(true);
                            setError("");
                            setMessage("");
                            try {
                                const result = await requestPasswordReauthentication();
                                if (result) setError(result);
                                else {
                                    setNonce("");
                                    setMessage("確認コードを再送信しました。");
                                }
                            } catch {
                                setError("通信に失敗しました。再度お試しください。");
                            } finally {
                                lock.current = false;
                                setBusy(false);
                            }
                        }}
                    >
                        確認コードを再送信
                    </Button>
                </>
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
            <Button
                type="submit"
                className="w-full"
                variant="primary"
                iconName={
                    {
                        "sign-in": "logIn",
                        "sign-up": "userRoundPlus",
                        recovery: "arrowRight",
                        email: "arrowRight",
                        password: "rotateCcw",
                    }[mode]
                }
                loading={busy}
                disabled={busy || (publicOperation && !token)}
            >
                {
                    {
                        "sign-in": "サインイン",
                        "sign-up": "サインアップ",
                        recovery: "続ける",
                        email: "続ける",
                        password: "変更",
                    }[mode]
                }
            </Button>
        </form>
    );
}
