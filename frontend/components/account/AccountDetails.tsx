"use client";

import Apps from "@/components/account/Apps";
import AuthForm from "@/components/account/AuthForm";
import Button from "@/components/ui/Button";
import { signOut } from "@/lib/auth/sign-out";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { IconName } from "@/components/ui/Icon";

export default function AccountDetails() {
    const buttonNames = ["連携アプリ", "メールアドレス", "パスワード"];
    const buttonIconNames: IconName[] = ["layoutGrid", "mail", "keyRound"];
    const [navigation, setNavigation] = useState(0);

    const router = useRouter();

    return (
        <>
            <div className="flex sm:flex-row flex-col w-full h-full gap-4">
                <div className="w-full sm:w-48 flex sm:flex-col shrink-0 no-scrollbar overflow-scroll gap-4 px-4 sm:px-0">
                    {buttonNames.map((item, index) => (
                        <Button
                            key={index}
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

                <div className="w-full px-4 sm:px-0">
                    {navigation == 0 ? (
                        <Apps />
                    ) : navigation == 1 ? (
                        <AuthForm key="email" mode="email" />
                    ) : (
                        <AuthForm key="password" mode="password" />
                    )}
                </div>
            </div>
        </>
    );
}
