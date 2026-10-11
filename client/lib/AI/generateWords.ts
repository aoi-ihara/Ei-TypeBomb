import "server-only";
import { z } from "zod";
import { Prompts } from "@posthog/ai";
import { gemini, posthog } from "./gemini";
import type { LegacyWord } from "@/type";

const prompts = new Prompts({ posthog });
const defaultModel = "gemini-3.5-flash-lite";
const defaultLength = 24;
const fallbackPrompt = `
You are an English vocabulary generator for a typing game.

Generate exactly {{length}} English words based on the theme provided below.

For each word:
- "en" must contain the English word.
- "jp" must contain a translation of that word into the language used in the theme.
- Choose words that are relevant to the theme.
- Consider the purpose, context, and difficulty implied by the theme.
- Do not generate duplicate words.
- Do not include explanations or additional text.

Theme:
{{theme}}
`;

export async function generateWords(theme: string) {
    const prompt = await prompts.get("etb-word-creation", {
        fallback: fallbackPrompt,
    });
    const model = z
        .string()
        .trim()
        .min(1)
        .catch(defaultModel)
        .parse(prompt.config?.model);
    const length = z
        .number()
        .int()
        .positive()
        .catch(defaultLength)
        .parse(prompt.config?.length);
    const contents = prompts.compile(prompt.prompt, { theme, length });
    const response = await gemini.models.generateContent({
        model,
        contents: `${contents}\n${theme}`,
        posthogPrivacyMode: true,
        posthogProperties: {
            $ai_prompt_name: prompt.name,
            $ai_prompt_version: prompt.version,
        },

        config: {
            responseMimeType: "application/json",
            responseJsonSchema: {
                type: "object",
                properties: {
                    words: {
                        type: "array",
                        minItems: length,
                        maxItems: length,
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

    const result = z
        .object({
            words: z
                .array(
                    z.object({
                        en: z.string().min(1),
                        jp: z.string().min(1),
                    }),
                )
                .length(length),
        })
        .parse(parsed);

    return result.words as LegacyWord[];
}
