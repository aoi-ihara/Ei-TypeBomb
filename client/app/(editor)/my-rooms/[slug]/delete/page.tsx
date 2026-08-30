"use client";

import { useState, useEffect, use } from "react";
import Button from "@/components/ui/Button";
import Shell from "@/components/layout/Shell";
import { useRouter, notFound } from "next/navigation";
import { getRoomFromId } from "@/lib/room/get";
import { deleteRoom } from "@/lib/room/delete";

export default function Page({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = use(params);

    const router = useRouter();
    const [error, setError] = useState("");
    const [isFournd, setIsFound] = useState(true);
    const [roomId, setRoomId] = useState<string | null>(null);
    const [roomTitle, setRoomTitle] = useState<string | null>(null);

    const deleteCurrentRoom = async () => {
        if (!roomId) return;
        const result = await deleteRoom(roomId);

        if (result) setError(result);
        else router.push("/my-rooms");
    };

    useEffect(() => {
        const getRoomInfo = async () => {
            const room = await getRoomFromId(slug);

            if (!room) {
                setIsFound(false);
                return;
            }

            setRoomId(room.id);
            setRoomTitle(room.title ?? "");
        };

        getRoomInfo();
    }, [slug]);

    if (!isFournd) {
        notFound();
    }

    return (
        <Shell
            title="Delete Room"
            size="small"
            className="flex flex-col gap-4"
            loading={!roomId}
        >
            <div data-cursor="text">
                Are you sure you want to delete this room? This action cannot be
                undone.
            </div>
            <div data-cursor="text" className="font-bold font-mono">
                {roomTitle}
            </div>
            <Button
                padding="large"
                variant="danger"
                className="w-full"
                onClick={() => deleteCurrentRoom()}
                iconName="trash"
            >
                Delete
            </Button>
            <Button
                padding="large"
                className="w-full"
                onClick={() => router.back()}
                iconName="x"
            >
                Cancel
            </Button>
            {error && <div className="text-red-500">{error}</div>}
        </Shell>
    );
}
