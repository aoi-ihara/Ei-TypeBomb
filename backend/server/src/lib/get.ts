import { createClient } from "@supabase/supabase-js";
import { roomFromRow, type RoomRow } from "../../../shared/room";
import { logEvent, logError } from "./console";

export const getRoomFromId = async (id: string, jwtToken: string) => {
    logEvent("SERVER", `ルーム取得開始: ${id}`);

    try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

        if (!url || !apiKey) {
            throw new Error("Supabase environment variables are missing");
        }

        const supabase = createClient(url, apiKey, {
            global: {
                headers: {
                    Authorization: `Bearer ${jwtToken}`,
                },
                fetch: (input, init) =>
                    fetch(input, {
                        ...init,
                        signal: AbortSignal.timeout(10_000),
                    }),
            },
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        });

        const startedAt = performance.now();

        const { data, error, status } = await supabase
            .from("ei_typebomb_rooms")
            .select(
                `
                id,
                title,
                user_id,
                explanation,
                max_players,
                game_duration,
                password,
                created_at,
                updated_at,
                items
            `,
            )
            .eq("id", id)
            .maybeSingle();

        const elapsed = Math.round(performance.now() - startedAt);

        logEvent("SERVER", `Supabase応答: HTTP ${status}, ${elapsed}ms`);

        if (error) {
            logError(
                "SERVER",
                `Supabase取得失敗: ${JSON.stringify({
                    code: error.code,
                    message: error.message,
                    details: error.details,
                    hint: error.hint,
                })}`,
            );
            return;
        }

        if (!data) return;

        logEvent("SERVER", `ルーム取得成功: ${data.id}`);

        return roomFromRow(data as RoomRow);
    } catch (error) {
        logError(
            "SERVER",
            `Supabase通信例外: ${
                error instanceof Error
                    ? `${error.name}: ${error.message}`
                    : String(error)
            }`,
        );
        return;
    }
};
