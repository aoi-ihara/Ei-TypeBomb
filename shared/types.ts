export type Word = {
    jp: string;
    en: string;
};

export type User = {
    displayName: string;
    userId: string;
};

export type GameState = {
    status: "waiting" | "countdown" | "playing"; // ゲームのステータス
    bombHolder: string | null; // 爆弾を持っている人
    wordIndex: number | null; // 現在の単語
    bombStatus: number; // 爆弾の色
    users: User[]; // ユーザー
    remainingTime: number; // 爆弾のステータス変更までの時間
};
