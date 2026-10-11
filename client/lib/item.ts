import type {
    Item,
    LegacyWord,
    Room,
    TypedRecallItem,
} from "@/type";

export const getRoomItems = (
    room: Pick<Room, "items"> | null | undefined,
): Item[] => room?.items ?? [];

export const legacyWireWordsToItems = (
    words: LegacyWord[] | null | undefined,
): TypedRecallItem[] =>
    words?.map((word, index) => ({
        id: `legacy-wire-${index}`,
        type: "typed_recall",
        prompt: word.jp,
        answer: word.en,
    })) ?? [];

export const itemsToLegacyWireWords = (
    items: Item[] | null | undefined,
): LegacyWord[] =>
    items
        ?.filter((item): item is TypedRecallItem => item.type === "typed_recall")
        .map((item) => ({
            jp: item.prompt,
            en: item.answer,
        })) ?? [];

export const isTypedRecallItem = (
    item: Item | null | undefined,
): item is TypedRecallItem => item?.type === "typed_recall";
