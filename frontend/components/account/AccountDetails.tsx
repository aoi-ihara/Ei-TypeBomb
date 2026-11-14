"use client";

import Apps from "@/components/account/Apps";
import AuthForm from "@/components/account/AuthForm";
import Button from "@/components/ui/Button";
import { signOut } from "@/lib/auth/sign-out";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { IconName } from "@/components/ui/Icon";
import Shell from "../layout/Shell";

export default function AccountDetails({
    mcpEnabled,
}: {
    mcpEnabled: boolean;
}) {
    const buttonNames = mcpEnabled
        ? ["接続", "メールアドレス", "パスワード"]
        : ["メールアドレス", "パスワード"];
    const buttonIconNames: IconName[] = mcpEnabled
        ? ["layoutGrid", "mail", "keyRound"]
        : ["mail", "keyRound"];
    const [navigation, setNavigation] = useState(0);

    const router = useRouter();

    return (
        <Shell
            sidebar={
                <div className="w-full sm:w-48 sm:pr-0 shrink-0 px-4 flex sm:flex-col gap-4 overflow-x-scroll no-scrollbar">
                    {buttonNames.map((item, index) => (
                        <Button
                            key={item}
                            className="w-fit shrink-0 sm:w-full"
                            variant={
                                navigation == index ? "primary" : "default"
                            }
                            onClick={() => setNavigation(index)}
                            iconName={buttonIconNames[index]}
                            alignment="left"
                        >
                            {buttonNames[index]}
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
                </div>
            }
            title="アカウント"
            size="medium"
        >
            <div className="w-full px-4 sm:px-0">
                {mcpEnabled && navigation == 0 ? (
                    <Apps />
                ) : navigation == (mcpEnabled ? 1 : 0) ? (
                    <AuthForm key="email" mode="email" />
                ) : (
                    <AuthForm key="password" mode="password" />
                )}
            </div>
        </Shell>
    );
}
