import type { Word } from "@/type";

export const validateEmail = (email?: string) => {
    const MAX_EMAIL_LENGTH = 254;

    if (!email) {
        return "メールアドレスを入力してください。";
    }

    email = email.trim();

    if (email.length > MAX_EMAIL_LENGTH) {
        return "メールアドレスの形式が正しくありません。";
    }

    if (email.indexOf("@") !== email.lastIndexOf("@")) {
        return "メールアドレスの形式が正しくありません。";
    }

    const at = email.indexOf("@");

    if (at <= 0 || at >= email.length - 1) {
        return "メールアドレスの形式が正しくありません。";
    }

    const local = email.slice(0, at);
    const domain = email.slice(at + 1);

    const dot = domain.lastIndexOf(".");

    if (local.length === 0 || dot <= 0 || dot === domain.length - 1) {
        return "メールアドレスの形式が正しくありません。";
    }

    return null;
};

export const validateWords = (words?: Word[]) => {
    const MAX_WORD_LENGTH = 32;
    const MAX_ARRAY_LENGTH = 512;

    if (!words) {
        return "単語を入力してください。";
    }

    if (words.length > MAX_ARRAY_LENGTH) {
        return "単語は512個以内にしてください。";
    }

    for (const item of words) {
        if (item.jp.length > MAX_WORD_LENGTH) {
            return "日本語訳は32文字以内で入力してください。";
        }

        if (item.en.length > MAX_WORD_LENGTH) {
            return "英単語は32文字以内で入力してください。";
        }

        if (!/^[a-zA-Z0-9.,?!\- ]+$/.test(item.en)) {
            return "英単語には半角英数字、スペース、記号（. , ? ! -）のみ使用できます。";
        }
    }

    return null;
};

export const validatePassword = (password?: string) => {
    const MIN_PASSWORD_LENGTH = 8;
    const MAX_PASSWORD_LENGTH = 64;

    if (!password) {
        return "パスワードを入力してください。";
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        return "パスワードは8文字以上で入力してください。";
    }

    if (password.length > MAX_PASSWORD_LENGTH) {
        return "パスワードは64文字以内で入力してください。";
    }

    return null;
};

export const validateMaxPlayers = (maxPlayers: number) => {
    const MAX_MAX_PLAYERS = 8;
    const MIN_MAX_PLAYERS = 2;

    if (!maxPlayers) {
        return "最大プレイヤー数を入力してください。";
    }

    if (maxPlayers < MIN_MAX_PLAYERS) {
        return "最大プレイヤー数は2人以上にしてください。";
    }

    if (maxPlayers > MAX_MAX_PLAYERS) {
        return "最大プレイヤー数は8人以下にしてください。";
    }

    return null;
};

export const validateExplanation = (explanation?: string) => {
    const MAX_EXPLANATION_LENGTH = 512;

    if (explanation && explanation.length > MAX_EXPLANATION_LENGTH) {
        return "説明は512文字以内で入力してください。";
    }

    return null;
};

export const validateTitle = (title?: string) => {
    const MAX_TITLE_LENGTH = 64;

    if (!title) {
        return "ルーム名を入力してください。";
    }

    if (title.length > MAX_TITLE_LENGTH) {
        return "ルーム名は64文字以内で入力してください。";
    }

    return null;
};

export const validateUsername = (username?: string) => {
    const MIN_USERNAME_LENGTH = 3;
    const MAX_USERNAME_LENGTH = 16;

    if (!username) {
        return "ユーザー名を入力してください。";
    }

    if (username.length < MIN_USERNAME_LENGTH) {
        return "ユーザー名は3文字以上で入力してください。";
    }

    if (username.length > MAX_USERNAME_LENGTH) {
        return "ユーザー名は16文字以内で入力してください。";
    }

    if (!/^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(username)) {
        return "ユーザー名には半角英小文字、数字、ピリオドのみ使用できます。";
    }

    return null;
};

const MAX_LINK_LENGTH = 64;
const MIN_LINK_LENGTH = 3;

export const validateLink = (link?: string) => {
    if (!link) {
        return "リンクを入力してください。";
    }

    if (link.length < MIN_LINK_LENGTH) {
        return "リンクは3文字以上で入力してください。";
    }

    if (link.length > MAX_LINK_LENGTH) {
        return "リンクは64文字以内で入力してください。";
    }

    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(link)) {
        return "リンクには半角英小文字、数字、ピリオド、ハイフンのみ使用できます。";
    }

    return null;
};
