import "server-only";
import { GoogleGenAI } from "@posthog/ai/gemini";
import { getPostHogClient } from "../posthog-server";

export const posthog = getPostHogClient();

export const gemini = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    posthog,
});
