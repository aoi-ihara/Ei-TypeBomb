import "server-only";

import { createAdminClient } from "@/lib/db/server";
import { getUser } from "@/lib/auth/session";

const DEFAULT_GEMINI_DAILY_LIMIT = 20;

export const getGeminiDailyLimit = () => {
    const value = Number(process.env.GEMINI_DAILY_LIMIT);

    if (!Number.isInteger(value) || value <= 0) {
        return DEFAULT_GEMINI_DAILY_LIMIT;
    }

    return value;
};

const getJstDate = () =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());

export const getGeminiUsage = async () => {
    const userId = await getUser();
    const limit = getGeminiDailyLimit();

    if (!userId) {
        return {
            generationCount: 0,
            remaining: 0,
            limit,
        };
    }

    const supabase = await createAdminClient();
    const usageDate = getJstDate();

    const { data, error } = await supabase
        .from("ei_type_bomb_gemini_usage")
        .select("generation_count")
        .eq("user_id", userId)
        .eq("usage_date", usageDate)
        .maybeSingle();

    if (error) throw error;

    const generationCount = data?.generation_count ?? 0;

    return {
        generationCount,
        remaining: Math.max(limit - generationCount, 0),
        limit,
    };
};

export const consumeGeminiGeneration = async () => {
    const userId = await getUser();
    if (!userId) throw new Error("Authentication required");

    const limit = getGeminiDailyLimit();
    const supabase = await createAdminClient();

    const { data, error } = await supabase.rpc("consume_gemini_generation", {
        p_user_id: userId,
        p_limit: limit,
    });

    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;

    if (!result?.allowed) {
        throw new Error("Daily Gemini generation limit reached.");
    }

    return {
        generationCount: Number(result.generation_count),
        remaining: Math.max(limit - Number(result.generation_count), 0),
        limit,
    };
};
