"use server";

import { generateWords } from "./generateWords";
import { consumeGeminiGeneration, getGeminiUsage } from "./usage";

export async function getGeminiUsageAction() {
    return getGeminiUsage();
}

export async function generateWordsAction(theme: string) {
    if (!theme.trim()) {
        throw new Error("Theme is required");
    }

    if (theme.length > 100) {
        throw new Error("Theme is too long");
    }

    try {
        await consumeGeminiGeneration();
        return await generateWords(theme);
    } catch (error) {
        console.error("Gemini generation failed:", error);

        if (
            error &&
            typeof error === "object" &&
            "message" in error &&
            typeof error.message === "string"
        ) {
            throw new Error(error.message);
        }

        throw new Error("Failed to generate words. Please try again.");
    }
}
