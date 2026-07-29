"use client";

import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useState, use, useEffect } from "react";
import { getRoomFromId } from "@/lib/room/get";
import { notFound, useRouter } from "next/navigation";
import posthog from "posthog-js";

export default function Import({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = use(params);
    const router = useRouter();

    const [json, setJson] = useState("");
    const [isFournd, setIsFound] = useState(true);
    const [roomId, setRoomId] = useState<string | null>(null);
    const [showCopiedText, setShowCopiedText] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(json);
        posthog.capture("words_exported", { room_id: slug });
        setShowCopiedText(true);
        setTimeout(() => {
            setShowCopiedText(false);
        }, 3000);
    };

    useEffect(() => {
        const getRoomInfo = async () => {
            const room = await getRoomFromId(slug);

            if (!room) {
                setIsFound(false);
                return;
            }

            setRoomId(room.id);
            setJson(JSON.stringify(room.words, null, 4));
        };

        getRoomInfo();
    }, [slug]);

    if (!isFournd) {
        notFound();
    }

    return (
        <Shell title="Export to JSON">
            <button
                onClick={handleCopy}
                data-cursor="button"
                className="rounded-lg w-full relative"
            >
                <div
                    className={`transition-all duration-200 ease-out active:scale-95`}
                >
                    <Input
                        onChange={() => {}}
                        label="Room Code"
                        font="mono"
                        variant="textarea"
                        inputClassName="h-96 resize-none"
                        className={`pointer-events-none transition-all duration-200 ease-out ${showCopiedText && "text-transparent"}`}
                        value={json}
                    />
                </div>

                <div className="absolute pointer-events-none top-0 left-0 w-full h-full flex justify-center items-center font-bold font-mono">
                    <div
                        className={`transition-all relative duration-200 ease-out text-cyan-600 ${
                            !showCopiedText && "opacity-0"
                        }`}
                    >
                        Copied
                    </div>
                </div>
            </button>

            <Button
                variant="primary"
                onClick={() => router.push(`/my-rooms/${roomId}`)}
                className="w-full"
            >
                Done
            </Button>
        </Shell>
    );
}
