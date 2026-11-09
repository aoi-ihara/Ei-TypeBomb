"use client";

import Apps from "@/components/account/Apps";
import AuthForm from "@/components/account/AuthForm";
import Button from "@/components/ui/Button";
import type { IconName } from "@/components/ui/Icon";
import { signOut } from "@/lib/auth/sign-out";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Shell from "../layout/Shell";

type Section = "connections" | "email" | "password";

export default function AccountDetails({ mcpEnabled }: { mcpEnabled: boolean }) {
    const sections: { id: Section; label: string; icon: IconName }[] = [
        ...(mcpEnabled
            ? [{ id: "connections" as const, label: "接続", icon: "layoutGrid" as const }]
            : []),
        { id: "email", label: "メールアドレス", icon: "mail" },
        { id: "password", label: "パスワード", icon: "keyRound" },
    ];
    const [navigation, setNavigation] = useState<Section>(
        mcpEnabled ? "connections" : "email",
    );
    const router = useRouter();

    return (
        <div className="flex w-full flex-col gap-12 sm:flex-row sm:gap-0">
            <nav
                aria-label="アカウント設定"
                className="flex w-full shrink-0 gap-4 overflow-x-auto px-4 no-scrollbar sm:w-48 sm:flex-col sm:pr-0"
            >
                {sections.map((section) => (
                    <Button
                        key={section.id}
                        className="w-fit shrink-0 sm:w-full"
                        variant={navigation === section.id ? "primary" : "default"}
                        onClick={() => setNavigation(section.id)}
                        iconName={section.icon}
                        alignment="left"
                    >
                        {section.label}
                    </Button>
                ))}
                <Button
                    variant="danger"
                    onClick={async () => {
                        await signOut();
                        router.refresh();
                    }}
                    className="w-fit shrink-0 sm:w-full"
                    iconName="logOut"
                    alignment="left"
                >
                    サインアウト
                </Button>
            </nav>

            <Shell title="アカウント" size="medium">
                <div className="w-full px-4 sm:px-0">
                    {navigation === "connections" && mcpEnabled ? (
                        <Apps />
                    ) : navigation === "email" ? (
                        <AuthForm key="email" mode="email" />
                    ) : (
                        <AuthForm key="password" mode="password" />
                    )}
                </div>
            </Shell>
        </div>
    );
}
