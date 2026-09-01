"use server";

import { gemini } from "./gemini";

export async function generateWordsWithGemini(theme: string) {
    const response = await gemini.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: `Hello! Give me one English word about ${theme}.`,
    });

    console.log(response.text);

    return response.text;
}
