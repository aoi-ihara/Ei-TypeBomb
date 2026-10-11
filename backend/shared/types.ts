export type TypedRecallItem = {
    id: string;
    type: "typed_recall";
    prompt: string;
    answer: string;
};
export type Item = TypedRecallItem;
export type User = { id: string; displayName?: string; pulse?: string };
export type Room = {
    id: string;
    userId?: string;
    title?: string;
    explanation?: string;
    items: Item[];
    maxPlayers?: number;
    gameDuration: number;
    password?: string | null;
    createdAt?: string;
    updatedAt?: string;
    users: User[];
    isStart: boolean;
    gameId?: string;
    bombHolder: number;
    wordIndex?: number;
    bombStatus: number;
};
// Serializable deadlines in epoch milliseconds. Transport IDs are opaque player IDs.
export type GameState = {
    room: Room;
    wordAt?: number;
    bombAt?: number;
    revision: number;
};
