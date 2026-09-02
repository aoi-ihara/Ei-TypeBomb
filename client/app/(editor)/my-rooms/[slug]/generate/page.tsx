"use client";

import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { generateWordsAction } from "@/lib/AI/actions";
import { getRoomFromId } from "@/lib/room/get";
import { updateRoomFromId } from "@/lib/room/update";
import { Word } from "@/type";
import { notFound, useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

const EXAMPLES = [
    "高校1年生の定期テストの単語",
    "入国審査で言われそうな単語",
    "プログラミングで使う英単語",
];

export default function Generate({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = use(params);

    const [prompt, setPrompt] = useState("");
    const [loading, setLoading] = useState(false);
    const [response, setResponse] = useState<Word[]>([]);
    const [isFound, setIsFound] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [words, setWords] = useState<Word[]>([]);
    const [error, setError] = useState("");

    const router = useRouter();

    useEffect(() => {
        const getRoomInfo = async () => {
            const room = await getRoomFromId(slug);

            if (!room) {
                setIsFound(false);
                return;
            }

            setWords(room.words ?? []);
        };

        getRoomInfo();
    }, []);

    const addWordsToRoom = async () => {
        const newWords = [...words, ...response];

        setUpdating(true);
        const result = await updateRoomFromId({
            id: slug,
            words: newWords,
        });
        setUpdating(false);
        if (error) setError(result ?? "");
        else router.push(`/my-rooms/${slug}`);
    };

    if (!isFound) notFound();

    return (
        <Shell title="Generate Words" size="large">
            <div className="flex gap-4 w-full">
                <Input
                    value={prompt}
                    label="Theme"
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full"
                />
                <Button
                    loading={loading}
                    onClick={async () => {
                        setLoading(true);
                        const response = await generateWordsAction(prompt);
                        setLoading(false);

                        setResponse(response);
                    }}
                    iconName="arrowRight"
                    variant="primary"
                    padding="large"
                />
            </div>

            {!prompt && !response.length && (
                <div
                    className={`grid gap-4 grid-cols-[repeat(auto-fit,minmax(256px,1fr))] origin-top w-full transition-all ease-out duration-200`}
                >
                    {EXAMPLES.map((item, index) => (
                        <Button
                            onClick={() => setPrompt(item)}
                            className="w-full flex"
                            key={index}
                        >
                            {item}
                        </Button>
                    ))}
                </div>
            )}

            {response.length !== 0 && (
                <div
                    className={`grid gap-4 grid-cols-[repeat(auto-fit,minmax(256px,1fr))] origin-top w-full transition-all ease-out duration-200`}
                >
                    {response.map((item, index) => (
                        <div
                            data-cursor="text"
                            className="truncate rounded-lg bg-(--color-background-secondary) py-1 px-2"
                            key={index}
                        >
                            {item.jp}
                            <div className="w-full font-mono">{item.en}</div>
                        </div>
                    ))}
                </div>
            )}

            <Button
                variant="primary"
                iconName="plus"
                loading={updating}
                onClick={async () => addWordsToRoom()}
                className="w-full"
                disabled={!response.length}
            >
                Add
            </Button>
        </Shell>
    );
}
