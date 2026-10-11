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

export type Room = {
    id: string;
    userId?: string;
    title?: string;
    explanation?: string;
    items?: Item[];
    maxPlayers?: number;
    gameDuration?: number;
    password?: string | null;
    createdAt?: string;
    updatedAt?: string;
    link?: string;
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
