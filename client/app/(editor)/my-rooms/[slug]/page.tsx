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
import { useState, useEffect, use, useRef } from "react";
import { getRoomFromId, getRoomFromLink } from "@/lib/room/get";
import { updateRoomFromId } from "@/lib/room/update";
import { Room } from "@/type";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { notFound, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import {
    validateExplanation,
    validateLink,
    validateMaxPlayers,
    validateTitle,
} from "@/lib/auth/validator";
import posthog from "posthog-js";
import { Icon } from "@/components/ui/Icon";

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
    const [showCopiedText, setShowCopiedText] = useState(false);
    const [link, setLink] = useState("");
    const [linkError, setLinkError] = useState("");
    const [showRoomId, setShowRoomId] = useState(false);

    const isLoadedRef = useRef(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setShowRoomId(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    const roomDataRef = useRef({
        title,
        explanation,
        password,
        maxPlayers,
        words,
        id,
    });

    useEffect(() => {
        roomDataRef.current = {
            title,
            explanation,
            password,
            maxPlayers,
            words,
            id,
        };
    }, [title, explanation, password, maxPlayers, words, id, link]);

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
            setLink(room.link ?? room.id);

            const wordsWithId: WordWithId[] = (room.words ?? []).map(
                (w: Word) => ({
                    ...w,
                    id: crypto.randomUUID(),
                }),
            );
            setWords(wordsWithId);

            isLoadedRef.current = true;
        };

        getRoomInfo();
    }, [slug]);

    const saveRoomData = async () => {
        const roomLinkResult = await getRoomFromLink(link);
        if (roomLinkResult && roomLinkResult !== slug) {
            setLinkError("Link has already taken.");
        } else {
            setLinkError("");
        }

        const { id, title, explanation, maxPlayers, words } =
            roomDataRef.current;

        if (!id || !words) return;

        try {
            const updatedRoom: Room = {
                id,
                title,
                explanation,
                maxPlayers: Number(maxPlayers),
                words: words.map(({ jp, en }) => ({ jp, en })),
                link,
            };

            const result = await updateRoomFromId(updatedRoom);
            console.log("Auto-saved successfully", result);
        } catch (err) {
            console.error("Failed to auto-save room:", err);
        }
    };

    useEffect(() => {
        if (!isLoadedRef.current || !id || words === null) return;

        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }

        timerRef.current = setTimeout(() => {
            saveRoomData();
        }, 2000);
    }, [title, explanation, maxPlayers, words, id, link]);

    const handleCopy = async () => {
        const joinLink = process.env.NEXT_PUBLIC_JOIN_LINK! + link;
        await navigator.clipboard.writeText(joinLink);
        posthog.capture("room_code_copied", { room_id: slug });
        setShowCopiedText(true);
        setTimeout(() => {
            setShowCopiedText(false);
        }, 3000);
    };

    if (error) {
        notFound();
    }

    return (
        <div className="px-4 flex flex-col max-w-2xl gap-4 w-full pb-4">
            {id ? (
                <>
                    <div>
                        <div className="flex mt-16 mb-4 items-center">
                            <Button
                                onClick={() =>
                                    router.push(`/my-rooms/${slug}/visibility`)
                                }
                                variant="text"
                                className="h-full"
                            >
                                <div className="w-8 h-10 flex justify-center items-center">
                                    {password ? (
                                        <Icon name="lock" />
                                    ) : (
                                        <Icon name="earth" />
                                    )}
                                </div>
                            </Button>
                            <input
                                className="w-full outline-none text-2xl font-bold font-mono"
                                value={title}
                                placeholder="Room Title"
                                data-cursor="text"
                                onChange={(e) => setTitle(e.target.value)}
                            />
                        </div>
                        {validateTitle(title) && (
                            <div className="text-red-500" data-cursor="text">
                                {validateTitle(title)}
                            </div>
                        )}
                    </div>

                    <div
                        data-cursor="text"
                        className="font-bold flex w-fit text-lg"
                    >
                        General
                    </div>

                    <div className="w-full grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
                        <div className="flex flex-col gap-4">
                            <Input
                                onChange={(e) => setExplanation(e.target.value)}
                                label="Explanation"
                                value={explanation}
                            />
                            {validateExplanation(explanation) && (
                                <div
                                    className="text-red-500"
                                    data-cursor="text"
                                >
                                    {validateExplanation(explanation)}
                                </div>
                            )}
                        </div>
                        <div className="flex flex-col gap-4">
                            <Input
                                onChange={(e) => setMaxPlayers(e.target.value)}
                                label="Max Players"
                                type="number"
                                min={2}
                                max={8}
                                value={maxPlayers}
                            />
                            {validateMaxPlayers(Number(maxPlayers)) && (
                                <div
                                    className="text-red-500"
                                    data-cursor="text"
                                >
                                    {validateMaxPlayers(Number(maxPlayers))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="w-full flex flex-col gap-4">
                            <Input
                                onChange={(e) => setLink(e.target.value)}
                                label="Invite Link"
                                font="mono"
                                inputClassName="pl-19.5"
                                className={`transition-all w-full duration-200 ease-out`}
                                value={link}
                                disableLabelAnimation={true}
                            >
                                <div className="font-mono opacity-50 absolute top-4 left-5 pointer-events-none">
                                    /join/
                                </div>
                            </Input>
                            {validateLink(link) && (
                                <div
                                    className="text-red-500"
                                    data-cursor="text"
                                >
                                    {validateLink(link)}
                                </div>
                            )}
                            {linkError && (
                                <div
                                    className="text-red-500"
                                    data-cursor="text"
                                >
                                    {linkError}
                                </div>
                            )}
                        </div>

                        <Button
                            className="w-fit shrink-0"
                            padding="large"
                            iconName="qrCode"
                            onClick={() => setShowRoomId(true)}
                        ></Button>

                        <Button
                            className="w-fit shrink-0"
                            onClick={handleCopy}
                            padding="large"
                            iconName={showCopiedText ? "check" : "copy"}
                        ></Button>
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
                                    <SortableItem key={word.id} id={word.id}>
                                        <div className="flex items-center gap-4 w-full">
                                            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] w-full">
                                                <div className="flex flex-col gap-4">
                                                    <Input
                                                        label="Label"
                                                        value={word.jp}
                                                        onChange={(e) => {
                                                            const newWords =
                                                                words.map(
                                                                    (w, i) =>
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
                                                            setWords(newWords);
                                                        }}
                                                    />
                                                    {word.jp.length > 32 && (
                                                        <div
                                                            className="text-red-500"
                                                            data-cursor="text"
                                                        >
                                                            It is too long.
                                                        </div>
                                                    )}
                                                    {!word.jp && (
                                                        <div
                                                            className="text-red-500"
                                                            data-cursor="text"
                                                        >
                                                            This field is
                                                            required.
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
                                                                    (w, i) =>
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
                                                            setWords(newWords);
                                                        }}
                                                    />
                                                    {!/^[a-zA-Z0-9.,?!\- ]+$/.test(
                                                        word.en,
                                                    ) &&
                                                        word.en && (
                                                            <div className="text-red-500">
                                                                You can use only
                                                                letters,
                                                                numbers, spaces,
                                                                and the
                                                                following
                                                                punctuation: .,
                                                                ,, !, ?, and -.
                                                            </div>
                                                        )}
                                                    {word.en.length > 32 && (
                                                        <div
                                                            className="text-red-500"
                                                            data-cursor="text"
                                                        >
                                                            It is too long.
                                                        </div>
                                                    )}
                                                    {!word.en && (
                                                        <div
                                                            className="text-red-500"
                                                            data-cursor="text"
                                                        >
                                                            This field is
                                                            required.
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
                                                                    i !== index,
                                                            );
                                                        setWords(newWords);
                                                    }}
                                                    className="h-fit"
                                                    padding="large"
                                                    iconName="trash"
                                                />
                                            </div>
                                        </div>
                                    </SortableItem>
                                ))}
                            </SortableContext>
                        </DndContext>
                    )}

                    {words && (
                        <div className="w-full flex gap-4">
                            <Button
                                onClick={() => {
                                    setWords([
                                        ...words,
                                        {
                                            id: crypto.randomUUID(),
                                            en: "",
                                            jp: "",
                                        },
                                    ]);

                                    posthog.capture("word_added");
                                }}
                                className="w-full"
                                padding="large"
                                iconName="plus"
                            >
                                Add
                            </Button>

                            <Button
                                onClick={() =>
                                    router.push(`/my-rooms/${slug}/import`)
                                }
                                iconName="upload"
                                padding="large"
                            />
                        </div>
                    )}

                    <div
                        data-cursor="text"
                        className="font-bold flex w-fit text-lg mt-4"
                    >
                        Settings
                    </div>

                    <div className="w-full grid gap-4 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
                        <Button
                            onClick={() =>
                                router.push(`/my-rooms/${slug}/visibility`)
                            }
                            className=""
                            iconName="eye"
                        >
                            Visibility
                        </Button>
                        <Button
                            onClick={() =>
                                router.push(`/my-rooms/${slug}/export`)
                            }
                            className=""
                            iconName="download"
                        >
                            Export
                        </Button>
                        <Button
                            onClick={() =>
                                router.push(`/my-rooms/${slug}/delete`)
                            }
                            variant="danger"
                            className=""
                            iconName="trash"
                        >
                            Delete Room
                        </Button>
                    </div>
                </>
            ) : (
                <div className="w-full flex justify-center">
                    <h1
                        className="text-2xl mt-16 mb-8 font-bold font-mono gradient-text"
                        data-cursor="text"
                    >
                        Loading…
                    </h1>
                </div>
            )}

            <div
                className={`w-full h-full flex justify-center px-4 gap-16 items-center flex-col  fixed top-0 left-0 bg-(--color-background) ${
                    !showRoomId && "opacity-0 scale-95 pointer-events-none"
                } z-100 transition-all overlay duration-200 ease-out`}
                onClick={() => setShowRoomId(false)}
            >
                <div className="font-extrabold text-cyan-600 text-2xl">
                    Ei-TypeBomb
                </div>
                <div className="w-full bg-(--color-background) gap-16 flex flex-col md:flex-row justify-center items-center">
                    <QRCodeSVG
                        value={process.env.NEXT_PUBLIC_JOIN_LINK! + link}
                        size={256}
                        fgColor="var(--color-foreground)"
                        bgColor="var(--color-background)"
                        className="text-(--color-foreground)"
                    />
                    <div className="w-64 md:w-0.5 h-0.5 md:h-64 bg-(--color-border)"></div>
                    <div className="flex items-center justify-center">
                        <div className="font-bold bg-(--color-background-secondary) px-4 py-2 rounded-lg font-mono text-center leading-tight text-4xl">
                            {link}
                        </div>
                    </div>
                </div>
                <div className="opacity-50">
                    Press escape or click to return.
                </div>
            </div>
        </div>
    );
}
