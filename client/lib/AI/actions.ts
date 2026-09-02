"use server";

import { generateWords } from "./generateWords";

export async function generateWordsAction(theme: string) {
    if (!theme.trim()) {
        throw new Error("Theme is required");
    }

    if (theme.length > 100) {
        throw new Error("Theme is too long");
    }

    return generateWords(theme);
}
