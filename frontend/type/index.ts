export type LegacyWord = {
    jp: string;
    en: string;
};

export type TypedRecallItem = {
    id: string;
    type: "typed_recall";
    prompt: string;
    answer: string;
};

export type Item = TypedRecallItem;

export type GameBomb = {
    id: string;
    holder: number;
    status: number;
    wordIndex?: number;
    turn: number;
    at: number;
    hintLength?: number;
};
export type GameLoser = { id: string; displayName?: string };
export type RoomVisibility = "public" | "unlisted" | "private";

export type Room = {
    id: string;
    userId?: string;
    title?: string;
    explanation?: string;
    items?: Item[];
    itemCount?: number;
    maxPlayers?: number;
    bombCount?: number | null;
    gameDuration?: number;
    password?: string | null;
    createdAt?: string;
    updatedAt?: string;
    link?: string;
    revision?: number;
    bombs?: GameBomb[];
    losers?: GameLoser[];
    typingFocusPlayerId?: string;
    typingFocusInput?: string;
    visibility?: RoomVisibility;
};

export type User = {
    id: string;
    displayName?: string;
    pulse?: string;
};

export type Position = {
    x: number;
    y: number;
    w: number;
    h: number;
    opacity: number;
};
