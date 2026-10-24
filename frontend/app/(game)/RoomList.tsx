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

type CurrentUser = {
    id: string;
    email: string | null;
    displayName: string | null;
};

type Props = {
    rooms: Room[];
    view: "public" | "me";
    currentUser: CurrentUser | null;
    initialBackgroundMusic: boolean;
    initialSoundEffects: boolean;
};

export default function RoomList({
    rooms,
    view,
    currentUser,
    initialBackgroundMusic,
    initialSoundEffects,
}: Props) {
    const router = useRouter();
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState("");
    const [showSettings, setShowSettings] = useState(false);
    const [backgroundMusic, setBackgroundMusic] = useState(initialBackgroundMusic);
    const [soundEffects, setSoundEffects] = useState(initialSoundEffects);

    useEffect(() => {
        if (!currentUser) return;
        posthog.identify(currentUser.id, {
            email: currentUser.email,
            display_name: currentUser.displayName,
        });
    }, [currentUser]);

    const setCookie = (key: string, value: boolean) => {
        document.cookie = key + "=" + String(value) + "; path=/; max-age=31536000; SameSite=Lax";
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
            setCreateError("ルームを作成できませんでした。もう一度お試しください。");
            setCreating(false);
        }
    };

    const handleSignOut = async () => {
        posthog.capture("signed_out");
        posthog.reset();
        await signOut();
        router.replace("/");
    };

    return (
        <div className="min-h-dvh w-full px-4 pb-24">
            <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 border-b border-(--color-border) py-4">
                <Link href="/" className="text-lg font-bold tracking-tight">
                    Ei-TypeBomb
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                    <MorphDialog
                        button={
                            <Button
                                variant="text"
                                iconName="settings"
                                onClick={() => setShowSettings(true)}
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

                    {currentUser ? (
                        <>
                            <Button variant="text" onClick={() => router.push("/?owner=me")}>
                                自分のルーム
                            </Button>
                            {process.env.NEXT_PUBLIC_USER_SETTINGS_URL && (
                                <Button
                                    variant="text"
                                    onClick={() => router.push(process.env.NEXT_PUBLIC_USER_SETTINGS_URL!)}
                                >
                                    ユーザー設定
                                </Button>
                            )}
                            <Button variant="text" onClick={handleSignOut}>
                                サインアウト
                            </Button>
                        </>
                    ) : (
                        <Button variant="text" onClick={() => router.push(getSignInUrl())}>
                            ログイン
                        </Button>
                    )}
                </div>
            </header>

            <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 pt-10">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="mb-2 text-sm opacity-60">ROOMS</p>
                        <h1 className="text-3xl font-bold" data-cursor="text">
                            ルーム一覧
                        </h1>
                    </div>
                    <Button onClick={addRoom} loading={creating} iconName="plus">
                        ルームを作成
                    </Button>
                </div>

                <nav className="flex gap-2 border-b border-(--color-border)" aria-label="ルームの絞り込み">
                    <Link
                        href="/"
                        aria-current={view === "public" ? "page" : undefined}
                        className={"px-4 py-3 font-semibold transition-colors " + (view === "public" ? "border-b-2 border-cyan-600" : "opacity-60")}
                    >
                        共有ルーム
                    </Link>
                    <Link
                        href="/?owner=me"
                        aria-current={view === "me" ? "page" : undefined}
                        className={"px-4 py-3 font-semibold transition-colors " + (view === "me" ? "border-b-2 border-cyan-600" : "opacity-60")}
                    >
                        自分のルーム
                    </Link>
                </nav>

                {createError && <p className="text-red-500" role="alert">{createError}</p>}

                {rooms.length > 0 ? (
                    <div className="grid w-full gap-4 sm:grid-cols-2">
                        {rooms
                            .slice()
                            .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
                            .map((room) => (
                                <RoomCard key={room.id} room={room} isOwner={view === "me"} />
                            ))}
                    </div>
                ) : (
                    <div className="rounded-xl bg-(--color-background-secondary) px-6 py-12 text-center">
                        <p className="font-semibold">
                            {view === "me" ? "まだルームがありません" : "共有されているルームはありません"}
                        </p>
                        <p className="mt-2 text-sm opacity-60">
                            {view === "me" ? "ルームを作成して、単語リストを準備しましょう。" : "公開されたルームがここに表示されます。"}
                        </p>
                    </div>
                )}
            </main>
        </div>
    );
}
