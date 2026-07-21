"use client";

import {
    DndContext,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
    arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, useEffect, use } from "react";
import { getRoomFromId } from "@/lib/room/get";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { notFound } from "next/navigation";
import { useRouter } from "next/navigation";
import { updateRoomFromId } from "@/lib/room/update";

type Word = {
    jp: string;
    en: string;
};

type WordWithId = Word & {
    id: string;
};

function SortableItem({
    id,
    children,
}: {
    id: string;
    children: React.ReactNode;
}) {
    const { attributes, listeners, setNodeRef, transform, transition } =
        useSortable({ id });

    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
            }}
            className="flex gap-4"
        >
            <div
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing flex items-center px-2 select-none"
            >
                ☰
            </div>

            {children}
        </div>
    );
}

export default function Page({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = use(params);

    const router = useRouter();

    const [error, setError] = useState(false);
    const [explanation, setExplanation] = useState("");
    const [title, setTitle] = useState("");
    const [password, setPassword] = useState("");
    const [maxPlayers, setMaxPlayers] = useState<string>("2");
    const [id, setId] = useState<string | null>(null);
    const [words, setWords] = useState<WordWithId[] | null>(null);

    const sensors = useSensors(useSensor(PointerSensor));

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id || !words) return;

        const oldIndex = words.findIndex((w) => w.id === active.id);
        const newIndex = words.findIndex((w) => w.id === over.id);

        setWords(arrayMove(words, oldIndex, newIndex));
    };

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
            setPassword(room.password ?? "");
            setMaxPlayers(room.maxPlayers?.toString() ?? "2");

            const wordsWithId: WordWithId[] = (room.words ?? []).map(
                (w: Word) => ({
                    ...w,
                    id: crypto.randomUUID(),
                }),
            );
            setWords(wordsWithId);
        };

        getRoomInfo();
    }, [slug]);

    if (error) {
        notFound();
    }

    return (
        <>
            <div className={`px-4 flex flex-col max-w-2xl gap-4 w-full`}>
                {id ? (
                    <>
                        <input
                            className={`w-full outline-none text-2xl mt-16 mb-8 font-bold font-mono`}
                            value={title}
                            placeholder="Room Title"
                            data-cursor="text"
                            onChange={(e) => setTitle(e.target.value)}
                        />

                        <div className="w-full grid gap-5 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
                            <Input
                                onChange={(e) => setExplanation(e.target.value)}
                                label="Explanation"
                                value={explanation}
                            />
                        </div>

                        <div className="w-full grid gap-5 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
                            <div className="flex flex-col gap-4">
                                <Input
                                    onChange={(e) =>
                                        setMaxPlayers(e.target.value)
                                    }
                                    label="Max Players"
                                    type="number"
                                    min={2}
                                    max={8}
                                    value={maxPlayers}
                                />
                                {Number(maxPlayers) > 8 && (
                                    <div className="text-red-500">
                                        Mex Players must be 8 or less.
                                    </div>
                                )}
                                {Number(maxPlayers) < 2 && (
                                    <div className="text-red-500">
                                        Mex Players must be 2 or more.
                                    </div>
                                )}
                            </div>
                            {password ? (
                                <Button
                                    padding="large"
                                    className="w-full"
                                    onClick={() =>
                                        router.push(
                                            `/my-rooms/${slug}/password`,
                                        )
                                    }
                                >
                                    Change Password
                                </Button>
                            ) : (
                                <Button
                                    padding="large"
                                    className="w-full"
                                    onClick={() =>
                                        router.push(
                                            `/my-rooms/${slug}/password`,
                                        )
                                    }
                                >
                                    Set Password
                                </Button>
                            )}
                        </div>

                        <div
                            data-cursor="text"
                            className="font-bold flex w-fit text-lg mt-4"
                        >
                            Words
                        </div>

                        {words && (
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={words.map((w) => w.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    {words.map((word, index) => (
                                        <SortableItem
                                            key={word.id}
                                            id={word.id}
                                        >
                                            <div className="flex gap-4 w-full">
                                                <div className="grid gap-5 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] w-full">
                                                    <div className="flex flex-col gap-4">
                                                        <Input
                                                            label="Label"
                                                            value={word.jp}
                                                            onChange={(e) => {
                                                                const newWords =
                                                                    words.map(
                                                                        (
                                                                            w,
                                                                            i,
                                                                        ) =>
                                                                            i ===
                                                                            index
                                                                                ? {
                                                                                      ...w,
                                                                                      jp: e
                                                                                          .target
                                                                                          .value,
                                                                                  }
                                                                                : w,
                                                                    );
                                                                setWords(
                                                                    newWords,
                                                                );
                                                            }}
                                                        />
                                                        {word.jp.length >
                                                            32 && (
                                                            <div className="text-red-500">
                                                                Explanation is
                                                                too long.
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-col gap-4">
                                                        <Input
                                                            label="Correct Answer"
                                                            font="mono"
                                                            value={word.en}
                                                            onChange={(e) => {
                                                                const newWords =
                                                                    words.map(
                                                                        (
                                                                            w,
                                                                            i,
                                                                        ) =>
                                                                            i ===
                                                                            index
                                                                                ? {
                                                                                      ...w,
                                                                                      en: e
                                                                                          .target
                                                                                          .value,
                                                                                  }
                                                                                : w,
                                                                    );
                                                                setWords(
                                                                    newWords,
                                                                );
                                                            }}
                                                        />
                                                        {!/^[a-zA-Z0-9.,?!\- ]+$/.test(
                                                            word.en,
                                                        ) &&
                                                            word.en && (
                                                                <div className="text-red-500">
                                                                    You can use
                                                                    only
                                                                    letters,
                                                                    numbers,
                                                                    spaces, and
                                                                    the
                                                                    following
                                                                    punctuation:
                                                                    ., ,, !, ?,
                                                                    and -.
                                                                </div>
                                                            )}
                                                    </div>
                                                </div>

                                                <div>
                                                    <Button
                                                        onClick={() => {
                                                            const newWords =
                                                                words.filter(
                                                                    (_, i) =>
                                                                        i !==
                                                                        index,
                                                                );
                                                            setWords(newWords);
                                                        }}
                                                        variant="text"
                                                        className="h-full"
                                                    >
                                                        <div className="w-13 h-14 flex justify-center items-center">
                                                            <svg
                                                                xmlns="http://www.w3.org/2000/svg"
                                                                height="32px"
                                                                viewBox="0 -960 960 960"
                                                                width="32px"
                                                                fill="currentColor"
                                                            >
                                                                <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm80-160h80v-360h-80v360Zm160 0h80v-360h-80v360Z" />
                                                            </svg>
                                                        </div>
                                                    </Button>
                                                </div>
                                            </div>
                                        </SortableItem>
                                    ))}
                                </SortableContext>
                            </DndContext>
                        )}

                        {words && (
                            <Button
                                onClick={() =>
                                    setWords([
                                        ...words,
                                        {
                                            id: crypto.randomUUID(),
                                            en: "",
                                            jp: "",
                                        },
                                    ])
                                }
                                className="w-full"
                            >
                                Add
                            </Button>
                        )}
                    </>
                ) : (
                    <h1
                        className="w-full text-2xl mt-16 mb-8 font-bold font-mono text-center gradient-text"
                        data-cursor="text"
                    >
                        {id ? title : "Loading…"}
                    </h1>
                )}
            </div>
        </>
    );
}
