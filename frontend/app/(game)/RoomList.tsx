"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Room } from "@/type";
import RoomCard from "@/components/ui/RoomCard";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import MorphDialog from "@/components/ui/MorphDialog";
import { createNewRoom } from "@/lib/room/create";
import { getSignInUrl } from "@/lib/auth/sign-in-url";
import { signOut } from "@/lib/auth/sign-out";
import posthog from "posthog-js";
import Menu from "@/components/ui/Menu";
import { Icon } from "@/components/ui/Icon";
import Shell from "@/components/layout/Shell";
import Input from "@/components/ui/Input";
import Picker from "@/components/ui/Picker";
import Image from "next/image";

type CurrentUser = {
    id: string;
    email: string | null;
    displayName: string | null;
};

type Props = {
    publicRooms: Room[];
    myRooms: Room[];
    initialView: "public" | "me";
    currentUser: CurrentUser | null;
    initialBackgroundMusic: boolean;
    initialSoundEffects: boolean;
};

export default function RoomList({
    publicRooms,
    myRooms,
    initialView,
    currentUser,
    initialBackgroundMusic,
    initialSoundEffects,
}: Props) {
    const router = useRouter();
    const [creating, setCreating] = useState(false);
    const [showCursor, setShowCursor] = useState(true);
    const [createError, setCreateError] = useState("");
    const [showSettings, setShowSettings] = useState(false);
    const [backgroundMusic, setBackgroundMusic] = useState(
        initialBackgroundMusic,
    );
    const [soundEffects, setSoundEffects] = useState(initialSoundEffects);
    const [view, setView] = useState<"public" | "me">(initialView);
    const rooms = view === "me" ? myRooms : publicRooms;

    const selectView = (nextView: "public" | "me") => {
        if (nextView === "me" && !currentUser) {
            router.push(getSignInUrl());
            return;
        }

        setView(nextView);

        // Filter query parameters are for entering this page from elsewhere.
        // Once the user interacts with the in-page filter, normalize the URL.
        if (window.location.pathname === "/" && window.location.search) {
            window.history.replaceState(window.history.state, "", "/");
        }
    };

    useEffect(() => {
        if (!currentUser) return;
        posthog.identify(currentUser.id, {
            email: currentUser.email,
            display_name: currentUser.displayName,
        });
    }, [currentUser]);

    const setCookie = (key: string, value: boolean) => {
        document.cookie =
            key +
            "=" +
            String(value) +
            "; path=/; max-age=31536000; SameSite=Lax";
    };

    const addRoom = async () => {
        if (creating) return;
        if (!currentUser) {
            router.push(getSignInUrl());
            return;
        }

        setCreating(true);
        setCreateError("");
        try {
            const roomId = await createNewRoom();
            if (!roomId) throw new Error("Room creation returned no ID");
            posthog.capture("room_created");
            router.push("/" + roomId + "/edit");
        } catch (error) {
            console.error("Failed to create room:", error);
            setCreateError(
                "ルームを作成できませんでした。もう一度お試しください。",
            );
            setCreating(false);
        }
    };

    const handleSignOut = async () => {
        posthog.capture("signed_out");
        posthog.reset();
        await signOut();
        router.replace("/");
    };

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => {
            clearInterval(intervalId);
        };
    }, []);

    return (
        <>
            <header className={`w-full flex justify-end p-4 gap-4`}>
                <div className="w-18">
                    <MorphDialog
                        button={
                            <Button
                                variant="text"
                                onClick={() => setShowSettings(!showSettings)}
                                iconName="settings"
                            >
                                設定
                            </Button>
                        }
                        title="設定"
                        alignment="vertical"
                        open={showSettings}
                        onClose={() => setShowSettings(false)}
                    >
                        <div className="flex w-full items-center justify-between pl-3">
                            <div data-cursor="text">BGM</div>
                            <Toggle
                                checked={backgroundMusic}
                                onChange={(next) => {
                                    setBackgroundMusic(next);
                                    setCookie("background-music", next);
                                    posthog.capture("settings_changed", {
                                        setting: "background_music",
                                        value: next,
                                    });
                                }}
                            />
                        </div>
                        <div className="flex w-full items-center justify-between pl-3">
                            <div data-cursor="text">効果音</div>
                            <Toggle
                                checked={soundEffects}
                                onChange={(next) => {
                                    setSoundEffects(next);
                                    setCookie("sound-effects", next);
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

                {currentUser ? (
                    <Menu
                        name="ユーザーアクション"
                        button={
                            <Button variant="text" iconName="circleUserRound">
                                ユーザー
                            </Button>
                        }
                        items={[
                            {
                                label: "ルーム一覧",
                                icon: "layoutGrid",
                                onClick: () => selectView("me"),
                            },
                            {
                                label: "ユーザー設定",
                                icon: "userRoundCog",
                                onClick: () =>
                                    router.push(
                                        process.env
                                            .NEXT_PUBLIC_USER_SETTINGS_URL!,
                                    ),
                            },
                            {
                                label: "サインアウト",
                                icon: "logOut",
                                onClick: handleSignOut,
                            },
                        ]}
                    />
                ) : (
                    <Button
                        variant="text"
                        onClick={() => router.push(getSignInUrl())}
                    >
                        ログイン
                    </Button>
                )}
            </header>

            <div className="items-center mb-4 rounded-lg overflow-clip">
                <Image
                    src={showCursor ? "/favicon.svg" : "/favicon-2.svg"}
                    alt="page-logo"
                    width={150}
                    height={150}
                />
            </div>

            <Shell size="large">
                <Button
                    onClick={addRoom}
                    loading={creating}
                    iconName="plus"
                    className="shrink-0 w-full"
                >
                    新規
                </Button>
                <div className="flex w-full gap-4">
                    <Input value="f" />
                </div>

                <div className="grid gap-4 w-full grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
                    <Picker
                        name="ゲーム時間"
                        labelPrefix="作成者"
                        selection={0}
                        items={["すべて", "自分", "自分以外"]}
                        itemIcons={[null, null, null]}
                        onSelected={(index) => {}}
                    />
                    <Picker
                        name="公開設定"
                        labelPrefix="作成者"
                        selection={0}
                        items={["公開", "自分"]}
                        itemIcons={[null, null, null]}
                        onSelected={(index) => {}}
                    />
                    <Picker
                        name="問題数"
                        labelPrefix="問題数"
                        selection={0}
                        items={[
                            "0",
                            "0~",
                            "10~",
                            "20~",
                            "40~",
                            "60~",
                            "80~",
                            "100~",
                        ]}
                        itemIcons={[null, null, null]}
                        onSelected={(index) => {}}
                    />
                </div>

                {createError && (
                    <p className="text-red-500" role="alert">
                        {createError}
                    </p>
                )}

                {rooms.length > 0 ? (
                    <div className="grid w-full gap-4 sm:grid-cols-2">
                        {rooms
                            .slice()
                            .sort(
                                (a, b) =>
                                    new Date(b.updatedAt ?? 0).getTime() -
                                    new Date(a.updatedAt ?? 0).getTime(),
                            )
                            .map((room) => (
                                <RoomCard
                                    key={room.id}
                                    room={room}
                                    isOwner={view === "me"}
                                />
                            ))}
                    </div>
                ) : (
                    <div className="rounded-xl bg-(--color-background-secondary) px-6 py-12 text-center">
                        <p className="font-semibold">
                            {view === "me"
                                ? "まだルームがありません"
                                : "共有されているルームはありません"}
                        </p>
                        <p className="mt-2 text-sm opacity-60">
                            {view === "me"
                                ? "ルームを作成して、単語リストを準備しましょう。"
                                : "公開されたルームがここに表示されます。"}
                        </p>
                    </div>
                )}
            </Shell>
        </>
    );
}
