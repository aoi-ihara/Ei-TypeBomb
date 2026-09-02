import "server-only";
import { gemini } from "./gemini";

const wordSchema = {
    type: "object",
    properties: {
        words: {
            type: "array",
            minItems: 24,
            maxItems: 24,
            items: {
                type: "object",
                properties: {
                    en: {
                        type: "string",
                    },
                    jp: {
                        type: "string",
                    },
                },
                required: ["en", "jp"],
            },
        },
    },
    required: ["words"],
};

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
            responseJsonSchema: wordSchema,
        },
    });

    if (!response.text) {
        throw new Error("Gemini returned empty response");
    }

    const result = JSON.parse(response.text);

    if (!Array.isArray(result.words)) {
        throw new Error("Invalid response format");
    }

    if (result.words.length !== 24) {
        throw new Error(
            `Expected 24 words, but received ${result.words.length}`,
        );
    }

    return result.words;
}
