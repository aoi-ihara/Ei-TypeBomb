"use client";

import Apps from "./Apps";
import Security, { type SecurityScreen } from "./Security";
import Button from "@/components/ui/Button";
import Shell from "@/components/layout/Shell";
import type { IconName } from "@/components/ui/Icon";
import { signOut } from "@/lib/auth/sign-out";
import {
    identifyPostHogUser,
    type PostHogIdentityUser,
} from "@/lib/analytics/posthog-identity";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import posthog from "posthog-js";

type AccountSection = "apps" | "security";
const sections: { key: AccountSection; label: string; icon: IconName }[] = [
    { key: "apps", label: "アプリ", icon: "layoutGrid" },
    { key: "security", label: "セキュリティ", icon: "shield" },
];

export default function AccountSettings({ user }: { user: PostHogIdentityUser }) {
    const [section, setSection] = useState<AccountSection>("apps");
    const [securityScreen, setSecurityScreen] = useState<SecurityScreen>("overview");
    const router = useRouter();

    useEffect(() => {
        identifyPostHogUser(user);
    }, [user]);

    const title =
        section === "apps"
            ? "アプリ"
            : securityScreen === "overview"
              ? "セキュリティ"
              : securityScreen === "email"
                ? "メールアドレス"
                : "パスワード";

    return (
        <Shell
            sidebar={
                <div className="w-full sm:w-48 sm:pr-0 shrink-0 px-4 flex sm:flex-col gap-4 overflow-x-scroll no-scrollbar">
                    {sections.map(({ key, label, icon }) => (
                        <Button
                            key={key}
                            className="w-fit shrink-0 sm:w-full"
                            variant={section === key ? "primary" : "default"}
                            iconName={icon}
                            alignment="left"
                            onClick={() => {
                                setSection(key);
                                setSecurityScreen("overview");
                            }}
                        >
                            {label}
                        </Button>
                    ))}
                    <Button
                        variant="danger"
                        onClick={async () => {
                            posthog.reset();
                            try {
                                await signOut();
                                router.refresh();
                            } catch (error) {
                                unstable_rethrow(error);
                                identifyPostHogUser(user);
                                throw error;
                            }
                        }}
                        className="w-fit shrink-0 sm:w-full"
                        iconName="logOut"
                        alignment="left"
                    >
                        サインアウト
                    </Button>
                </div>
            }
            title={title}
            size="medium"
        >
            <div className="w-full px-4 sm:px-0">
                {section === "apps" ? (
                    <Apps />
                ) : (
                    <Security
                        screen={securityScreen}
                        onScreenChange={setSecurityScreen}
                    />
                )}
            </div>
        </Shell>
    );
}
