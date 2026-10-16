"use client";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getUserDetails } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/sign-out";
import posthog from "posthog-js";
import { Icon } from "@/components/ui/Icon";
import Button from "@/components/ui/Button";
import { useFeatureFlagEnabled } from "posthog-js/react";
import MorphDialog from "@/components/ui/MorphDialog";
import Menu from "@/components/ui/Menu";
import Toggle from "@/components/ui/Toggle";

type Props = {
    initialSounDeffects: boolean;
    initialBackgroundMusic: boolean;
};

export default function Home({
    initialSounDeffects,
    initialBackgroundMusic,
}: Props) {
    const [showCursor, setShowCursor] = useState(true);
    const [userId, setUserId] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(false);

    const redesignedSignInButton = useFeatureFlagEnabled(
        "redesignedSignInButton",
    );
    const [backgroundMusic, setBackgroundMusic] = useState(
        initialBackgroundMusic,
    );
    const [sounDeffects, setSounDeffects] = useState(initialSounDeffects);

    const setCookie = (key: string, value: string) => {
        document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000`;
    };

    const router = useRouter();

    useEffect(() => {
        const fetchUserData = async () => {
            const user = await getUserDetails();
            if (!user) return;

            setUserId(user.id);

            posthog.identify(user.id, {
                email: user.email,
                display_name: user.displayName,
            });
        };

        fetchUserData();
    }, [router]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => {
            clearInterval(intervalId);
        };
    }, []);

    return (
        <div className="flex flex-col h-dvh w-dvw">
            <div
                className={`w-full flex justify-end p-2 ${redesignedSignInButton && "border-b border-(--color-border)"}`}
            >
                {userId ? (
                    <Menu
                        name="ユーザーアクション"
                        button={
                            <div
                                className="rounded-lg"
                                data-cursor="button"
                                data-cursor-shape="1"
                            >
                                <button
                                    aria-label="ユーザーメニューを開く"
                                    className="h-8 w-8 flex items-center justify-center rounded-lg font-semibold active:scale-95 transition-all cursor-pointer duration-(--duration-etb) ease-etb"
                                >
                                    <Icon name="circleUserRound" />
                                </button>
                            </div>
                        }
                        items={[
                            {
                                label: "ルーム一覧",
                                onClick: () => router.push("/my-rooms"),
                            },
                            {
                                label: "サインアウト",
                                onClick: () => {
                                    posthog.capture("signed_out");
                                    posthog.reset();
                                    signOut();
                                    setUserId(null);
                                },
                            },
                        ]}
                    />
                ) : (
                    <div
                        className="rounded-lg"
                        data-cursor="button"
                        data-cursor-shape="1"
                    >
                        <button
                            className="flex h-8 items-center px-2 font-semibold cursor-pointer rounded-lg active:scale-95 transition-all duration-(--duration-etb) ease-etb"
                            onClick={() => router.push(getSignInUrl())}
                        >
                            ログイン
                        </button>
                    </div>
                )}
            </div>
            <div className="flex h-full flex-col justify-center items-center gap-4">
                <div className="items-center mb-12 rounded-lg overflow-clip">
                    <Image
                        src={showCursor ? "/favicon.svg" : "/favicon-2.svg"}
                        alt="page-logo"
                        width={150}
                        height={150}
                    />
                </div>

                <div className="w-64 gap-4 flex flex-col">
                    <Button
                        className="w-full"
                        iconName="play"
                        onClick={() => router.push("/room")}
                        variant="primary"
                    >
                        プレイ
                    </Button>

                    <MorphDialog
                        button={
                            <Button
                                className="w-full"
                                iconName="settings"
                                onClick={() => setShowSettings(true)}
                            >
                                設定
                            </Button>
                        }
                        title="設定"
                        alignment="vertical"
                        open={showSettings}
                        onClose={() => setShowSettings(!showSettings)}
                    >
                        <div className="w-full pl-3 items-center flex justify-between">
                            <div data-cursor="text">BGM</div>
                            <Toggle
                                checked={backgroundMusic}
                                onChange={(next) => {
                                    setBackgroundMusic(next);
                                    setCookie("background-music", String(next));
                                    posthog.capture("settings_changed", {
                                        setting: "background_music",
                                        value: next,
                                    });
                                }}
                            />
                        </div>
                        <div className="w-full pl-3 items-center flex justify-between">
                            <div data-cursor="text">効果音</div>
                            <Toggle
                                checked={sounDeffects}
                                onChange={(next) => {
                                    setSounDeffects(next);
                                    setCookie("sound-effects", String(next));
                                    posthog.capture("settings_changed", {
                                        setting: "sound_effects",
                                        value: next,
                                    });
                                }}
                            />
                        </div>
                        <Button
                            className="w-full"
                            variant="primary"
                            iconName="check"
                            onClick={() => setShowSettings(false)}
                        >
                            完了
                        </Button>
                    </MorphDialog>
                </div>

                {userId ? (
                    <Button
                        variant="text"
                        iconName="layoutGrid"
                        onClick={() => router.push("/my-rooms")}
                    >
                        ルーム一覧
                    </Button>
                ) : (
                    <Button
                        variant="text"
                        iconName="logIn"
                        onClick={() => router.push(getSignInUrl())}
                    >
                        サインイン
                    </Button>
                )}
            </div>
        </div>
    );
}
