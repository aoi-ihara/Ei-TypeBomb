export type Word = {
    jp: string;
    en: string;
};

export type Room = {
    id: string;
    userId?: string;
    title?: string;
    explanation?: string;
    words?: Word[];
    maxPlayers?: number;
    password?: string | null;
    createdAt?: string;
    updatedAt?: string;
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
