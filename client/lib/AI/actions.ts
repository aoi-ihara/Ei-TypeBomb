"use server";

import { generateWords } from "./generateWords";
import {
    consumeGeminiGeneration,
    GenerationUsageError,
    getGeminiUsage,
} from "./usage";
import type { Word } from "@/type";

export async function getGeminiUsageAction() {
    return getGeminiUsage();
}

export async function generateWordsAction(
    theme: string,
): Promise<{ words: Word[] } | { error: string }> {
    if (!theme.trim()) {
        return { error: "テーマを入力してください。" };
    }

    if (theme.length > 100) {
        return { error: "テーマは100文字以内で入力してください。" };
    }

    try {
        await consumeGeminiGeneration();
        return { words: await generateWords(theme) };
    } catch (error) {
        console.error("Gemini generation failed:", error);
        return {
            error:
                error instanceof GenerationUsageError
                    ? error.message
                    : "単語の生成に失敗しました。もう一度お試しください。",
        };
    }
}
