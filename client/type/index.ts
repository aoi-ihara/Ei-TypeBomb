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
    password?: string;
    createdAt?: string;
    updatedAt?: string;
};
