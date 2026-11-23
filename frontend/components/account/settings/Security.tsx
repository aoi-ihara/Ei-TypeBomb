"use client";

import AuthForm from "@/components/account/AuthForm";
import Button from "@/components/ui/Button";
import type { IconName } from "@/components/ui/Icon";

export type SecurityScreen = "overview" | "email" | "password";
const entries: {
    key: Exclude<SecurityScreen, "overview">;
    label: string;
    icon: IconName;
}[] = [
    { key: "email", label: "メールアドレス", icon: "mail" },
    { key: "password", label: "パスワード", icon: "keyRound" },
];

export default function Security({
    screen,
    onScreenChange,
}: {
    screen: SecurityScreen;
    onScreenChange: (screen: SecurityScreen) => void;
}) {
    if (screen !== "overview") {
        return (
            <div className="flex w-full flex-col gap-4">
                <Button
                    variant="text"
                    className="w-fit"
                    iconName="arrowLeft"
                    onClick={() => onScreenChange("overview")}
                >
                    セキュリティへ戻る
                </Button>
                <AuthForm
                    key={screen}
                    mode={screen}
                    requireReauthentication={screen === "password"}
                />
            </div>
        );
    }

    return (
        <div className="flex w-full flex-col gap-4">
            {entries.map(({ key, label, icon }) => (
                <Button
                    key={key}
                    className="w-full"
                    variant="default"
                    iconName={icon}
                    alignment="left"
                    onClick={() => onScreenChange(key)}
                >
                    {label}
                </Button>
            ))}
        </div>
    );
}
