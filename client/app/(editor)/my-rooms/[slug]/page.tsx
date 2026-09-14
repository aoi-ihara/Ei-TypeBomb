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
import Shell from "@/components/layout/Shell";
import Dialog from "@/components/ui/Dialog";
import { deleteRoom } from "@/lib/room/delete";
import Collapsible from "@/components/ui/Collapsible";
import { generateWordsAction, getGeminiUsageAction } from "@/lib/AI/actions";

const EXAMPLES = [
    "高校1年生の定期テストの単語",
    "大学受験でよく見る英単語",
    "英語のニュースでよく使われる単語",
    "日常会話でよく使う英単語",
    "入国審査で言われそうな単語",
    "ホテルで使いそうな英単語",
];

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

    const [roomError, setRoomError] = useState(false);
    const [roomExplanation, setRoomExplanation] = useState("");
    const [roomTitle, setRoomTitle] = useState("");
    const [roomPassword, setRoomPassword] = useState("");
    const [maxPlayers, setMaxPlayers] = useState<string>("2");
    const [roomId, setRoomId] = useState<string | null>(null);
    const [words, setWords] = useState<WordWithId[] | null>(null);
    const [isLinkCopied, setIsLinkCopied] = useState(false);
    const [roomLink, setRoomLink] = useState("");
    const [roomLinkError, setRoomLinkError] = useState("");
    const [showRoomCode, setShowRoomCode] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [showImportDialog, setShowImportDialog] = useState(false);
    const [importData, setImportData] = useState("");
    const [importError, setImportError] = useState("");
    const [showImportInput, setShowImportInput] = useState(false);
    const [showVisibilitySettings, setShowVisibilitySettings] = useState(false);

    const [newPassword, setNewPassword] = useState("");
    const [isPrivate, setIsPrivate] = useState(false);
    const [confirmPassword, setConfirmPassword] = useState("");

    const [isExported, setIsExported] = useState(false);

    const [showGenerationInput, setShowGenerationInput] = useState(false);
    const [generationPrompt, setGenerationPrompt] = useState("");
    const [generatedWords, setGeneratedWords] = useState<Word[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationError, setGenerationError] = useState("");
    const [isGeminiLimitReached, setIsGeminiLimitReached] = useState(false);
    const [isGeminiUsageLoading, setIsGeminiUsageLoading] = useState(true);

    const [visibilityError, setVisibilityError] = useState("");
    const [isUpdatingVisibilitySettings, setIsUpdatingVisibilitySettings] =
        useState(false);

    const isLoadedRef = useRef(false);
    const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setShowRoomCode(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadGeminiUsage = async () => {
            try {
                const usage = await getGeminiUsageAction();
                if (!cancelled) {
                    setIsGeminiLimitReached(usage.remaining <= 0);
                }
            } catch (error) {
                console.error("Failed to load Gemini usage:", error);
            } finally {
                if (!cancelled) setIsGeminiUsageLoading(false);
            }
        };

        loadGeminiUsage();

        return () => {
            cancelled = true;
        };
    }, []);

    const refreshGeminiUsage = async () => {
        try {
            const usage = await getGeminiUsageAction();
            setIsGeminiLimitReached(usage.remaining <= 0);
        } catch (error) {
            console.error("Failed to refresh Gemini usage:", error);
        }
    };

    const roomDataRef = useRef({
        roomTitle,
        roomExplanation,
        roomPassword,
        maxPlayers,
        words,
        roomId,
    });

    useEffect(() => {
        roomDataRef.current = {
            roomTitle,
            roomExplanation,
            roomPassword,
            maxPlayers,
            words,
            roomId,
        };
    }, [
        roomTitle,
        roomExplanation,
        roomPassword,
        maxPlayers,
        words,
        roomId,
        roomLink,
    ]);

    const sensors = useSensors(useSensor(PointerSensor));

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id || !words) return;

        const oldIndex = words.findIndex((word) => word.id === active.id);
        const newIndex = words.findIndex((word) => word.id === over.id);

        setWords(arrayMove(words, oldIndex, newIndex));
    };

    const handleDeleteRoom = async () => {
        if (!roomId) return;
        const result = await deleteRoom(roomId);

        if (result) throw result;
        else router.push("/my-rooms");
    };

    useEffect(() => {
        const loadRoom = async () => {
            const room = await getRoomFromId(slug);

            if (!room) {
                setRoomError(true);
                return;
            }

            setRoomId(room.id);
            setRoomTitle(room.title ?? "");
            setRoomExplanation(room.explanation ?? "");
            setRoomPassword(room.password ?? "");
            setMaxPlayers(room.maxPlayers?.toString() ?? "2");
            setRoomLink(room.link ?? room.id);

            const wordsWithId: WordWithId[] = (room.words ?? []).map(
                (word: Word) => ({
                    ...word,
                    id: crypto.randomUUID(),
                }),
            );
            setWords(wordsWithId);

            isLoadedRef.current = true;
        };

        loadRoom();
    }, [slug]);

    const handleExportWords = async () => {
        const jsonData = JSON.stringify(
            (words ?? []).map((word) => {
                return {
                    jp: word.jp,
                    en: word.en,
                };
            }),
            null,
            4,
        );
        await navigator.clipboard.writeText(jsonData);
        setIsExported(true);
        setTimeout(() => {
            setIsExported(false);
        }, 3000);
    };

    const handleCopyRoomLink = async () => {
        const joinLink = process.env.NEXT_PUBLIC_JOIN_LINK! + roomLink;
        await navigator.clipboard.writeText(joinLink);
        posthog.capture("room_code_copied", { room_id: slug });
        setIsLinkCopied(true);
        setTimeout(() => {
            setIsLinkCopied(false);
        }, 3000);
    };

    const handleImportWords = async () => {
        posthog.capture("words_imported_and_added", { room_id: slug });

        setImportError("");

        if (!roomId || words === null) return;

        if (!importData) {
            setImportError("JSON data is required.");
            return;
        }

        let parsedWords: Word[];

        try {
            parsedWords = JSON.parse(importData).map((word: Word) => ({
                jp: word.jp,
                en: word.en,
                id: crypto.randomUUID(),
            }));
        } catch {
            setImportError("Invalid JSON format.");
            return;
        }

        const importedWords = parsedWords as WordWithId[];
        const newWords = [...importedWords, ...words];
        setWords(newWords);

        setImportData("");
        setShowImportInput(false);
    };

    const handleVisibilityUpdate = async () => {
        setVisibilityError("");

        if (!slug) {
            console.error("Room ID is required.");
            return;
        }

        if (newPassword !== confirmPassword && isPrivate) {
            setVisibilityError("Passwords do not match.");
            return;
        }

        console.log(slug);

        const request: Room = {
            id: slug,
            password: isPrivate ? newPassword : null,
        };

        setIsUpdatingVisibilitySettings(true);
        const updateError = await updateRoomFromId(request);
        setIsUpdatingVisibilitySettings(false);

        if (updateError) setVisibilityError(updateError);
        else {
            posthog.capture("room_visibility_changed", {
                room_id: slug,
                is_private: isPrivate,
            });

            setRoomPassword(isPrivate ? "" : newPassword);
            setShowVisibilitySettings(false);
        }
    };

    const saveRoomData = async () => {
        const roomLinkResult = await getRoomFromLink(roomLink);
        if (roomLinkResult && roomLinkResult !== slug) {
            setRoomLinkError("Link has already taken.");
        } else {
            setRoomLinkError("");
        }

        const { roomId, roomTitle, roomExplanation, maxPlayers, words } =
            roomDataRef.current;

        if (!roomId || !words) return;

        try {
            const updatedRoom: Room = {
                id: roomId,
                title: roomTitle,
                explanation: roomExplanation,
                maxPlayers: Number(maxPlayers),
                words: words.map(({ jp, en }) => ({ jp, en })),
                link: roomLink,
            };

            const result = await updateRoomFromId(updatedRoom);
            console.log("Auto-saved successfully", result);
        } catch (err) {
            console.error("Failed to auto-save room:", err);
        }
    };

    useEffect(() => {
        if (!isLoadedRef.current || !roomId || words === null) return;

        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
        }

        saveTimerRef.current = setTimeout(() => {
            saveRoomData();
        }, 2000);
    }, [roomTitle, roomExplanation, maxPlayers, words, roomId, roomLink]);

    if (roomError) {
        notFound();
    }

    return (
        <Shell
            animateAppear={true}
            loading={!roomId}
            className="flex flex-col gap-4"
            size="large"
        >
            <div className="flex mt-16 mb-4 items-center w-full">
                <Button
                    onClick={() => router.push("/my-rooms")}
                    variant="text"
                    className="h-full"
                >
                    <div className="w-8 h-10 flex justify-center items-center">
                        <Icon name="arrowLeft" />
                    </div>
                </Button>
                <Button
                    onClick={() => {
                        if (roomPassword) setIsPrivate(true);
                        else setIsPrivate(false);

                        setNewPassword("");
                        setConfirmPassword("");

                        setShowVisibilitySettings(true);
                    }}
                    variant="text"
                    className="h-full"
                >
                    <div className="w-8 h-10 flex justify-center items-center">
                        {roomPassword ? (
                            <Icon name="lock" />
                        ) : (
                            <Icon name="earth" />
                        )}
                    </div>
                </Button>
                <input
                    className="w-full outline-none text-2xl font-bold font-mono"
                    value={roomTitle}
                    placeholder="Room Title"
                    data-cursor="text"
                    onChange={(e) => setRoomTitle(e.target.value)}
                />
            </div>
            {validateTitle(roomTitle) && (
                <div className="text-red-500" data-cursor="text">
                    {validateTitle(roomTitle)}
                </div>
            )}

            <div data-cursor="text" className="font-bold flex w-fit text-lg">
                General
            </div>

            <div className="w-full grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
                <div className="flex flex-col gap-4">
                    <Input
                        onChange={(e) => setRoomExplanation(e.target.value)}
                        label="Explanation"
                        value={roomExplanation}
                    />
                    {validateExplanation(roomExplanation) && (
                        <div className="text-red-500" data-cursor="text">
                            {validateExplanation(roomExplanation)}
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
                        <div className="text-red-500" data-cursor="text">
                            {validateMaxPlayers(Number(maxPlayers))}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex gap-4 w-full">
                <div className="w-full flex flex-col gap-4">
                    <Input
                        onChange={(e) => setRoomLink(e.target.value)}
                        label="Invite Link"
                        font="mono"
                        type="url"
                        inputClassName="pl-19.5"
                        className={`transition-all w-full duration-200 ease-out`}
                        value={roomLink}
                        disableLabelAnimation={true}
                    >
                        <div className="font-mono opacity-50 absolute top-4 left-5 pointer-events-none">
                            /join/
                        </div>
                    </Input>
                    {validateLink(roomLink) && (
                        <div className="text-red-500" data-cursor="text">
                            {validateLink(roomLink)}
                        </div>
                    )}
                    {roomLinkError && (
                        <div className="text-red-500" data-cursor="text">
                            {roomLinkError}
                        </div>
                    )}
                </div>

                <Button
                    className="w-fit shrink-0"
                    padding="large"
                    iconName="qrCode"
                    onClick={() => setShowRoomCode(true)}
                ></Button>

                <Button
                    className="w-fit shrink-0"
                    onClick={handleCopyRoomLink}
                    padding="large"
                    iconName={isLinkCopied ? "check" : "copy"}
                ></Button>
            </div>

            <div
                data-cursor="text"
                className="font-bold flex w-fit text-lg mt-4"
            >
                Settings
            </div>

            <div className="w-full grid gap-4 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
                <Button
                    onClick={() => {
                        if (roomPassword) setIsPrivate(true);
                        else setIsPrivate(false);

                        setNewPassword("");
                        setConfirmPassword("");

                        setShowVisibilitySettings(true);
                    }}
                    className=""
                    iconName="eye"
                >
                    Visibility
                </Button>
                <Dialog
                    title="Visibility Settings"
                    open={showVisibilitySettings}
                    alignment="vertical"
                    size="middle"
                    onClose={() => setShowVisibilitySettings(false)}
                >
                    <div className="w-full pl-2 items-center flex justify-between">
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
                        value={confirmPassword}
                        disabled={!isPrivate}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        label="Conform Password"
                        type="password"
                    />

                    {roomError && (
                        <div className="text-red-500" data-cursor="text">
                            {roomError}
                        </div>
                    )}

                    <div className="flex gap-4 w-full">
                        <Button
                            className="w-full"
                            onClick={() => setShowVisibilitySettings(false)}
                            iconName="x"
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            onClick={() => handleVisibilityUpdate()}
                            className="w-full"
                            iconName="check"
                            loading={isUpdatingVisibilitySettings}
                        >
                            Done
                        </Button>
                    </div>
                    {visibilityError && (
                        <div className="text-red-500" data-cursor="text">
                            {visibilityError}
                        </div>
                    )}
                </Dialog>

                <Button
                    onClick={() => handleExportWords()}
                    className=""
                    iconName={isExported ? "check" : "download"}
                >
                    {!isExported && "Export"}
                </Button>

                <Button
                    onClick={() => setShowDeleteDialog(true)}
                    variant="danger"
                    className=""
                    iconName="trash"
                >
                    Delete Room
                </Button>
                <Dialog
                    title="Are you sure you want to delete this room?"
                    description="This action cannot be undone."
                    open={showDeleteDialog}
                    onClose={() => setShowDeleteDialog(false)}
                >
                    <Button
                        iconName="x"
                        className="w-full"
                        onClick={() => setShowDeleteDialog(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="danger"
                        iconName="trash"
                        className="w-full"
                        onClick={() => handleDeleteRoom()}
                    >
                        Delete
                    </Button>
                </Dialog>
            </div>

            <div
                data-cursor="text"
                className="font-bold flex w-fit text-lg mt-4"
            >
                Words
            </div>

            {words && (
                <div className="w-full flex gap-4">
                    <Button
                        onClick={() => {
                            setShowImportInput(false);
                            setWords([
                                {
                                    id: crypto.randomUUID(),
                                    en: "",
                                    jp: "",
                                },
                                ...words,
                            ]);

                            posthog.capture("word_added");
                        }}
                        className="w-full"
                        iconName="plus"
                    >
                        Add
                    </Button>

                    <Button
                        onClick={() => {
                            setShowGenerationInput(!showGenerationInput);
                            setGenerationPrompt("");
                            setGenerationError("");
                            setGeneratedWords([]);
                            setShowImportInput(false);
                        }}
                        disabled={isGeminiUsageLoading || isGeminiLimitReached}
                        iconName="wandSparkles"
                    />

                    <Button
                        onClick={() => {
                            setImportError("");
                            setImportData("");
                            setShowImportInput(!showImportInput);
                            setShowGenerationInput(false);
                        }}
                        iconName="upload"
                    />
                    <Dialog
                        title="Import from JSON"
                        size="middle"
                        alignment="vertical"
                        open={showImportDialog}
                        onClose={() => setShowImportDialog(false)}
                    >
                        <div className="w-full px-2 flex flex-col items-start gap-4">
                            <div data-cursor="text">
                                Please make sure your JSON file follows this
                                format:
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
                                Each object must include a &quot;jp&quot; field
                                for the Japanese word and an &quot;en&quot;
                                field for the English word.
                            </div>
                        </div>
                        <Button
                            onClick={() => setShowImportDialog(false)}
                            variant="primary"
                            className="w-full"
                            iconName="check"
                        >
                            Done
                        </Button>
                    </Dialog>
                </div>
            )}

            {words && (
                <div className="flex flex-col">
                    <Collapsible
                        open={showGenerationInput}
                        className={`flex z-2 ${showGenerationInput ? "mb-4" : "scale-y-0 py-0 opacity-0 blur-md pointer-events-none"} flex-col rounded-3xl sm:-mx-4 bg-(--color-background) gap-4 origin-top ease-out transition-all duration-200`}
                        childrenClassName="flex p-4 flex-col gap-4 items-center"
                    >
                        <div className="flex gap-4 w-full">
                            <Input
                                value={generationPrompt}
                                label="Theme"
                                onChange={(e) =>
                                    setGenerationPrompt(e.target.value)
                                }
                                className="w-full"
                            />
                            <Button
                                loading={isGenerating}
                                disabled={!generationPrompt}
                                onClick={async () => {
                                    setIsGenerating(true);
                                    setGenerationError("");

                                    try {
                                        const generatedWords =
                                            await generateWordsAction(
                                                generationPrompt,
                                            );

                                        setGeneratedWords(generatedWords);
                                    } catch (error) {
                                        console.error(
                                            "Failed to generate words:",
                                            error,
                                        );

                                        setGeneratedWords([]);
                                        setGenerationError(
                                            error instanceof Error
                                                ? error.message
                                                : "Failed to generate words. Please try again.",
                                        );
                                    } finally {
                                        setIsGenerating(false);
                                        await refreshGeminiUsage();
                                    }
                                }}
                                iconName="arrowRight"
                                variant="primary"
                                padding="large"
                            />
                        </div>

                        {!generationPrompt && !generatedWords.length && (
                            <div className="grid animate-appear gap-4 grid-cols-[repeat(auto-fit,minmax(256px,1fr))] w-full">
                                {EXAMPLES.map((example, index) => (
                                    <Button
                                        iconName="plus"
                                        onClick={() =>
                                            setGenerationPrompt(example)
                                        }
                                        className="w-full flex"
                                        padding="small"
                                        alignment="left"
                                        key={index}
                                    >
                                        {example}
                                    </Button>
                                ))}
                            </div>
                        )}

                        {generatedWords.length !== 0 && (
                            <div
                                className={`grid gap-4 grid-cols-[repeat(auto-fit,minmax(256px,1fr))] origin-top w-full animate-appear transition-all ease-out duration-200`}
                            >
                                {generatedWords.map((word, index) => (
                                    <div
                                        data-cursor="text"
                                        className="truncate rounded-lg bg-(--color-background-secondary) py-1 px-2"
                                        key={index}
                                    >
                                        {word.jp}
                                        <div className="w-full font-mono">
                                            {word.en}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {generatedWords?.length !== 0 && (
                            <div className="flex gap-4 w-full">
                                <Button
                                    onClick={() =>
                                        setShowGenerationInput(false)
                                    }
                                    className="w-full animate-appear"
                                    iconName="x"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="primary"
                                    className="w-full animate-appear"
                                    iconName="plus"
                                    onClick={() => {
                                        if (!generatedWords) return;

                                        let parsedWords: Word[];

                                        try {
                                            parsedWords = generatedWords.map(
                                                (word: Word) => ({
                                                    jp: word.jp,
                                                    en: word.en,
                                                    id: crypto.randomUUID(),
                                                }),
                                            );
                                        } catch {
                                            setImportError(
                                                "Invalid JSON format.",
                                            );
                                            return;
                                        }

                                        const generatedWordsWithId =
                                            parsedWords as WordWithId[];

                                        setWords([
                                            ...generatedWordsWithId,
                                            ...words,
                                        ]);
                                        setShowGenerationInput(false);
                                    }}
                                >
                                    Add
                                </Button>
                            </div>
                        )}

                        {generationError && (
                            <div className="text-red-500" data-cursor="text">
                                {generationError}
                            </div>
                        )}
                    </Collapsible>
                    <Collapsible
                        open={showImportInput}
                        className={`flex z-2 ${showImportInput ? "mb-4" : "scale-y-0 py-0 opacity-0 blur-md pointer-events-none"} flex-col rounded-3xl sm:-mx-4 bg-(--color-background) gap-4 origin-top ease-out transition-all duration-200`}
                        childrenClassName="flex p-4 flex-col gap-4 items-center"
                    >
                        <div data-cursor="text" className="p-2">
                            Each object must include a &quot;jp&quot; field for
                            the Japanese word and an &quot;en&quot; field for
                            the English word.
                            <Button
                                onClick={() => setShowImportDialog(true)}
                                variant="text"
                            >
                                Learn More
                            </Button>
                        </div>
                        <Input
                            value={importData}
                            variant="textarea"
                            inputClassName="resize-none h-48"
                            font="mono"
                            onChange={(e) => setImportData(e.target.value)}
                            label="JSON Data"
                        />
                        {importData && (
                            <div className="w-full animate-appear grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
                                <Button
                                    onClick={() => setShowImportInput(false)}
                                    className="w-full"
                                    iconName="x"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="primary"
                                    className="w-full"
                                    iconName="plus"
                                    onClick={() => handleImportWords()}
                                >
                                    Import
                                </Button>
                            </div>
                        )}
                        {importError && (
                            <div className="text-red-500" data-cursor="text">
                                {importError}
                            </div>
                        )}
                    </Collapsible>
                    <div className="flex flex-col gap-4">
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={words.map((word) => word.id)}
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
                                                                    (
                                                                        currentWord,
                                                                        wordIndex,
                                                                    ) =>
                                                                        wordIndex ===
                                                                        index
                                                                            ? {
                                                                                  ...currentWord,
                                                                                  jp: e
                                                                                      .target
                                                                                      .value,
                                                                              }
                                                                            : currentWord,
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
                                                                    (
                                                                        currentWord,
                                                                        wordIndex,
                                                                    ) =>
                                                                        wordIndex ===
                                                                        index
                                                                            ? {
                                                                                  ...currentWord,
                                                                                  en: e
                                                                                      .target
                                                                                      .value,
                                                                              }
                                                                            : currentWord,
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
                                                                (
                                                                    _,
                                                                    wordIndex,
                                                                ) =>
                                                                    wordIndex !==
                                                                    index,
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
                    </div>
                </div>
            )}

            <div
                className={`w-full h-full flex justify-center px-8 md:px-16 gap-8 md:gap-16 items-center flex-col fixed top-0 left-0 bg-(--color-background) ${
                    !showRoomCode &&
                    "opacity-0 scale-95 blur-md pointer-events-none"
                } z-100 transition-all overlay duration-200 ease-out`}
                onClick={() => setShowRoomCode(false)}
            >
                <div className="font-extrabold text-cyan-600 text-2xl">
                    Ei-TypeBomb
                </div>
                <div className="w-full bg-(--color-background) gap-8 md:gap-16 flex flex-col lg:flex-row justify-center items-center">
                    <QRCodeSVG
                        value={process.env.NEXT_PUBLIC_JOIN_LINK! + roomLink}
                        size={256}
                        fgColor="var(--color-foreground)"
                        bgColor="var(--color-background)"
                        className="text-(--color-foreground) md:shrink-0"
                    />
                    <div className="w-64 lg:w-0.5 h-0.5 lg:h-64 bg-(--color-border) shrink-0"></div>
                    <div className="flex items-center justify-center">
                        <div className="font-bold bg-(--color-background-secondary) px-4 py-2 rounded-lg font-mono text-center tracking-wider leading-normal text-3xl sm:text-4xl">
                            {roomLink}
                        </div>
                    </div>
                </div>
                <div className="opacity-50">
                    Press escape or click to return.
                </div>
            </div>

            <div
                className={`fixed z-1 inset-0 flex items-center justify-center ${!(showImportInput || showGenerationInput) && "opacity-0 pointer-events-none scale-105"} transition-all duration-200 ease-out`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="dialog-title"
                aria-describedby={
                    showImportInput || showGenerationInput
                        ? "dialog-description"
                        : undefined
                }
            >
                <button
                    type="button"
                    aria-label="Close dialog"
                    onClick={() => {
                        setShowImportInput(false);
                        setShowGenerationInput(false);
                    }}
                    className={`absolute inset-0 cursor-default ${(showImportInput || showGenerationInput) && "bg-(--color-background-secondary)/50"} transition-all duration-200 ease-out`}
                />
            </div>
        </Shell>
    );
}
