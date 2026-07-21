"use client";

import { useState, useEffect, use } from "react";
import { getRoomFromId } from "@/lib/room/get";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { notFound } from "next/navigation";

export default function Page({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = use(params);

    const [error, setError] = useState(false);
    const [explanation, setExplanation] = useState("");
    const [title, setTitle] = useState("");
    const [id, setId] = useState<string | null>(null);

    useEffect(() => {
        const getRoomInfo = async () => {
            const room = await getRoomFromId(slug);

            if (!room) {
                setError(true);
                return;
            }

            setId(room.id);
            setTitle(room.title ?? "");
            setExplanation(room.explanation ?? "");
        };

        getRoomInfo();
    }, [slug]);

    if (error) {
        notFound();
    }

    return (
        <>
            <div className={`px-4 flex flex-col max-w-2xl w-full`}>
                {id ? (
                    <input
                        className={`w-full outline-none text-2xl mt-16 mb-8 font-bold font-mono`}
                        value={title}
                        data-cursor="text"
                        onChange={(e) => setTitle(e.target.value)}
                    />
                ) : (
                    <h1
                        className="w-fit text-2xl mt-16 mb-8 font-bold font-mono text-center gradient-text"
                        data-cursor="text"
                    >
                        {id ? title : "Loading…"}
                    </h1>
                )}

                <div className="w-full grid gap-5 grid-cols-[repeat(auto-fit,minmax(256px,1fr))]">
                    <Input
                        onChange={(e) => setExplanation(e.target.value)}
                        label="Explanation"
                        value={explanation}
                    />
                    <Button
                        padding="large"
                        className="w-full"
                        onClick={() => {}}
                    >
                        Change Password
                    </Button>
                </div>
            </div>
        </>
    );
}
