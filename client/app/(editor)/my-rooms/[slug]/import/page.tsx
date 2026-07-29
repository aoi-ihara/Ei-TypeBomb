"use client";

import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useState, use, useEffect } from "react";
import { getRoomFromId } from "@/lib/room/get";
import { Word } from "@/type";
import { notFound, useRouter } from "next/navigation";
import { updateRoomFromId } from "@/lib/room/update";

export default function Import({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = use(params);
    const router = useRouter();

    const [json, setJson] = useState("");
    const [navigation, setNavigation] = useState(false);
    const [isFournd, setIsFound] = useState(true);
    const [roomId, setRoomId] = useState<string | null>(null);
    const [words, setWords] = useState<Word[]>([]);
    const [error, setError] = useState("");

    const importJson = async () => {
        if (!roomId) return;
        if (!json) {
            setError("JSON data is required.");
        }

        const parsedJson: Word[] = JSON.parse(json);
        const newWords = [...words, ...parsedJson];

        const result = await updateRoomFromId({ id: roomId, words: newWords });

        if (result) setError(result);
        else router.push(`/my-rooms/${roomId}`);
    };

    useEffect(() => {
        const getRoomInfo = async () => {
            const room = await getRoomFromId(slug);

            if (!room) {
                setIsFound(false);
                return;
            }

            setRoomId(room.id);
            setWords(room.words ?? []);
        };

        getRoomInfo();
    }, [slug]);

    if (!isFournd) {
        notFound();
    }

    if (navigation)
        return (
            <Shell title="Import & Overwrite" size="large">
                <div data-cursor="text">
                    Are you sure you want to delete current words? This action
                    cannot be undone.
                </div>

                {words.length !== 0 && (
                    <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(96px,1fr))] w-full">
                        {words.map((item, index) => (
                            <div
                                data-cursor="text"
                                className="truncate rounded-lg bg-(--color-background-secondary) py-1 px-2"
                                key={index}
                            >
                                {item.en}
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex gap-4 w-full">
                    <Button
                        onClick={() => setNavigation(false)}
                        className="w-full"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={async () => {
                            if (!roomId) return;
                            const parsedJson: Word[] = JSON.parse(json);

                            const result = await updateRoomFromId({
                                id: roomId,
                                words: parsedJson,
                            });

                            if (result) setError(result);
                            else router.push(`/my-rooms/${roomId}`);
                        }}
                        className="w-full"
                        variant="danger"
                    >
                        Delete & Import
                    </Button>
                </div>
            </Shell>
        );

    return (
        <Shell title="Import from JSON" size="large">
            <div className="w-full flex flex-col items-start gap-4">
                <div data-cursor="text">
                    Please make sure your JSON file follows this format:
                </div>
                <div data-cursor="text">
                    {" "}
                    <pre className="text-sm">
                        {`[
    {
        "jp": "りんご",
        "en": "apple"
    },
    {
        "jp": "ねこ",
        "en": "cat"
    }
]`}
                    </pre>
                </div>
                <div className="opacity-50" data-cursor="text">
                    Each object must include a &quot;jp&quot; field for the
                    Japanese word and an &quot;en&quot; field for the English
                    word.
                </div>
            </div>
            <Input
                value={json}
                variant="textarea"
                inputClassName="resize-none h-64"
                font="mono"
                onChange={(e) => setJson(e.target.value)}
                label="JSON Data"
            />

            <div className="w-full grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
                <Button
                    variant="danger"
                    onClick={() => setNavigation(true)}
                    className="w-full"
                >
                    Import & Overwrite
                </Button>
                <Button
                    variant="primary"
                    onClick={() => importJson()}
                    className="w-full"
                >
                    Import & Add
                </Button>
            </div>
            {error && (
                <div className="text-red-500" data-cursor="text">
                    {error}
                </div>
            )}
        </Shell>
    );
}
