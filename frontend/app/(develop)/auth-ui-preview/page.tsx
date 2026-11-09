"use client";

import { useState, type FormEvent } from "react";
import Header from "@/components/layout/Header";
import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

type Screen = "sign-in" | "sign-up" | "reset-password" | "account";
const titles: Record<Screen, string> = {
    "sign-in": "ログイン",
    "sign-up": "アカウント作成",
    "reset-password": "パスワードをリセット",
    account: "アカウント",
};

/**
 * RC Hub auth UI migration preview.
 * All state is local to this component. No authentication, database writes,
 * cookies, OAuth requests, or production navigation are performed here.
 */
export default function AuthUiPreviewPage() {
    const [screen, setScreen] = useState<Screen>("sign-in");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    const navigate = (next: Screen) => {
        setScreen(next);
        setMessage("");
        setError("");
        setPassword("");
        setConfirmation("");
    };

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError("");
        setMessage("");

        if (screen === "sign-up" && password !== confirmation) {
            setError("パスワードが一致しません。");
            return;
        }

        if (screen === "reset-password") {
            setMessage("モック：パスワード再設定メールを送信した想定です。実際には送信されません。");
        } else if (screen === "sign-up") {
            setMessage("モック：確認メールを送信した想定です。アカウントは作成されません。");
        } else {
            navigate("account");
        }
    };

    return (
        <>
            <Header />
            <Shell title={titles[screen]}>
                <p className="w-full rounded-lg bg-(--color-background-secondary) px-4 py-3 text-sm" role="status">
                    UIプレビュー：認証・メール送信・データ保存は行いません。
                </p>

                {screen === "account" ? (
                    <>
                        <div className="w-full rounded-lg bg-(--color-background-secondary) p-4">
                            <p className="text-sm opacity-60">メールアドレス（入力例）</p>
                            <p className="mt-1 break-all font-mono">{email || "未入力"}</p>
                            <p className="mt-3 text-sm opacity-60">モックのログイン状態です。実際のセッションは変更されません。</p>
                        </div>
                        <Button className="w-full" variant="danger" onClick={() => navigate("sign-in")}>
                            ログアウト（モック）
                        </Button>
                    </>
                ) : (
                    <form className="flex w-full flex-col gap-4" onSubmit={submit}>
                        <Input
                            value={email}
                            label="メールアドレス"
                            type="email"
                            font="mono"
                            autoComplete="email"
                            onChange={(event) => setEmail(event.target.value)}
                        />
                        {screen !== "reset-password" && (
                            <Input
                                value={password}
                                label="パスワード"
                                type="password"
                                autoComplete={screen === "sign-in" ? "current-password" : "new-password"}
                                onChange={(event) => setPassword(event.target.value)}
                            />
                        )}
                        {screen === "sign-up" && (
                            <Input
                                value={confirmation}
                                label="パスワード（確認）"
                                type="password"
                                autoComplete="new-password"
                                onChange={(event) => setConfirmation(event.target.value)}
                            />
                        )}
                        {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
                        {message && <p className="text-sm" role="status">{message}</p>}
                        <Button className="w-full" variant="primary" type="submit">
                            {screen === "sign-in" ? "ログイン（モック）" : screen === "sign-up" ? "アカウント作成（モック）" : "再設定メールを送信（モック）"}
                        </Button>
                    </form>
                )}

                {screen === "sign-in" && (
                    <>
                        <Button className="w-full" variant="text" onClick={() => navigate("sign-up")}>アカウントを作成</Button>
                        <Button className="w-full" variant="text" onClick={() => navigate("reset-password")}>パスワードを忘れた場合</Button>
                    </>
                )}
                {(screen === "sign-up" || screen === "reset-password") && (
                    <Button className="w-full" variant="text" onClick={() => navigate("sign-in")}>ログインに戻る</Button>
                )}
            </Shell>
        </>
    );
}
