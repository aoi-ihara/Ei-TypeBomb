import "server-only";
import { z } from "zod";
import { gemini } from "./gemini";
import { Word } from "@/type";

const wordSchema = z.object({
    words: z
        .array(
            z.object({
                en: z.string().min(1),
                jp: z.string().min(1),
            }),
        )
        .length(24),
});

export async function generateWords(theme: string) {
    const response = await gemini.models.generateContent({
        model: "gemini-3.5-flash-lite",

        contents: `
You are an English vocabulary generator for a typing game.

Generate exactly 24 English words based on the theme provided below.

For each word:
- "en" must contain the English word.
- "jp" must contain a translation of that word into the language used in the theme.
- Choose words that are relevant to the theme.
- Consider the purpose, context, and difficulty implied by the theme.
- Do not generate duplicate words.
- Do not include explanations or additional text.

Theme:
${theme}
`,

        config: {
            responseMimeType: "application/json",
            responseJsonSchema: {
                type: "object",
                properties: {
                    words: {
                        type: "array",
                        minItems: 24,
                        maxItems: 24,
                        items: {
                            type: "object",
                            properties: {
                                en: { type: "string" },
                                jp: { type: "string" },
                            },
                            required: ["en", "jp"],
                        },
                    },
                },
                required: ["words"],
            },
        },
    });

    if (!response.text) {
        throw new Error("Gemini returned empty response");
    }

    const parsed = JSON.parse(response.text);

    const result = wordSchema.parse(parsed);

    return result.words as Word[];
}
