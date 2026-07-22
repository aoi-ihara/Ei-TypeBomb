"use client";

import { useState, useEffect, use } from "react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Shell from "@/components/layout/Shell";
import { updateRoomFromId } from "@/lib/room/update";
import { Room } from "@/type";
import { useRouter, notFound } from "next/navigation";
import { getRoomFromId } from "@/lib/room/get";

export default function Page({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = use(params);

    const router = useRouter();

    const [newPassword, setNewPassword] = useState("");
    const [error, setError] = useState("");
    const [isFournd, setIsFound] = useState(true);
    const [conformPassword, setConformPassword] = useState("");
    const [isPrivate, setIsPrivate] = useState(false);

    const handleUpdate = async () => {
        if (!slug) {
            console.error("Room ID is required.");
            return;
        }

        if (newPassword !== conformPassword && isPrivate) {
            setError("Passwords do not match.");
            return;
        }

        console.log(slug);

        const request: Room = {
            id: slug,
            password: isPrivate ? newPassword : null,
        };

        const error = await updateRoomFromId(request);

        if (error) setError(error);
        else router.push(`/my-rooms/${slug}`);
    };

    useEffect(() => {
        const getRoomInfo = async () => {
            const room = await getRoomFromId(slug);

            if (!room) {
                setIsFound(false);
                return;
            }

            setIsPrivate(!!room.password);
        };

        getRoomInfo();
    }, [slug]);

    if (!isFournd) {
        notFound();
    }

    return (
        <Shell title="Visibility Settings" className="flex flex-col gap-4">
            <div className="w-full items-center flex justify-between">
                <div data-cursor="text">Set to Private</div>
                <div data-cursor="button" className="rounded-full flex">
                    <button
                        className={`w-16 ${isPrivate ? "bg-cyan-600" : "bg-(--color-background-secondary)"} h-8 rounded-full p-1 transition-all duration-200 ease-out active:scale-95`}
                        onClick={() => {
                            const next = !isPrivate;

                            setIsPrivate(next);
                        }}
                    >
                        <div
                            className={`h-6 w-8 rounded-full bg-(--color-foreground) ${isPrivate && "ml-6"} transition-all duration-200 ease-out`}
                        ></div>
                    </button>
                </div>
            </div>

            <Input
                value={newPassword}
                disabled={!isPrivate}
                onChange={(e) => setNewPassword(e.target.value)}
                label="Room Password"
                type="password"
            />

            <Input
                value={conformPassword}
                disabled={!isPrivate}
                onChange={(e) => setConformPassword(e.target.value)}
                label="Conform Password"
                type="password"
            />

            <Button
                padding="large"
                variant="primary"
                onClick={() => handleUpdate()}
                className="w-full"
            >
                Done
            </Button>
            {error && <div className="text-red-500">{error}</div>}
        </Shell>
    );
}
