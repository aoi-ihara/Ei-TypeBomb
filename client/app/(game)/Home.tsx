"use client";

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
    const [showPopUp, setShowPopUp] = useState(false);
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
            {showPopUp && (
                <div
                    className="absolute top-0 left-0 w-full h-full"
                    onClick={() => setShowPopUp(false)}
                />
            )}
            <div
                className={`w-full flex justify-end p-2 ${redesignedSignInButton && "border-b border-(--color-border)"}`}
            >
                {userId ? (
                    <>
                        <div
                            className="relative rounded-lg"
                            data-cursor="button"
                            data-cursor-shape="1"
                        >
                            <button
                                className="h-8 w-8 flex items-center justify-center font-semibold $ active:scale-95 transition-all cursor-pointer duration-(--duration-etb) ease-etb"
                                onClick={() => setShowPopUp(!showPopUp)}
                            >
                                <Icon name="circleUserRound" />
                            </button>

                            <div
                                className={`absolute top-10 w-48 p-1 right-0 ${showPopUp ? "" : "opacity-0 pointer-events-none"} transition-all duration-(--duration-etb) ease-etb`}
                            >
                                <div
                                    className={`${!showPopUp && "scale-x-20 translate-x-21 -translate-y-16 scale-y-25"} transition-all duration-(--duration-etb) ease-etb`}
                                >
                                    <div
                                        className="rounded-sm w-full"
                                        data-cursor={showPopUp && "button"}
                                        data-cursor-shape="1"
                                    >
                                        <button
                                            className="flex cursor-pointer w-full h-8 items-center px-2 font-semibold rounded-lg active:scale-95 transition-all duration-(--duration-etb) ease-etb"
                                            onClick={() =>
                                                router.push("/my-rooms")
                                            }
                                        >
                                            ルーム一覧
                                        </button>
                                    </div>
                                    <div
                                        className="rounded-sm"
                                        data-cursor={showPopUp && "button"}
                                        data-cursor-shape="1"
                                    >
                                        <button
                                            className="flex cursor-pointer w-full h-8 items-center px-2 font-semibold rounded-lg active:scale-95 transition-all duration-(--duration-etb) ease-etb"
                                            onClick={() => {
                                                posthog.capture("signed_out");
                                                posthog.reset();
                                                signOut();
                                                setUserId(null);
                                            }}
                                        >
                                            サインアウト
                                        </button>
                                    </div>
                                </div>
                                <div
                                    className={`absolute right-0 ${showPopUp ? "w-48 top-0  h-full" : "w-8 -top-10 h-8"} rounded-lg -z-1 transition-all duration-(--duration-etb) ease-etb bg-(--color-background-secondary)`}
                                />
                            </div>
                        </div>
                    </>
                ) : (
                    <div
                        className="rounded-lg"
                        data-cursor="button"
                        data-cursor-shape="1"
                    >
                        <button
                            className="flex h-8 items-center px-2 font-semibold cursor-pointer rounded-lg active:scale-95 transition-all duration-(--duration-etb) ease-etb"
                            onClick={() =>
                                router.push(
                                    process.env.NEXT_PUBLIC_SIGN_IN_URL!,
                                )
                            }
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
                        <div className="w-full px-3 items-center flex justify-between">
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
                        <div className="w-full px-3 items-center flex justify-between">
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
                        onClick={() =>
                            router.push(process.env.NEXT_PUBLIC_SIGN_IN_URL!)
                        }
                    >
                        サインイン
                    </Button>
                )}
            </div>
        </div>
    );
}
