"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRoomFromId = void 0;
const db_1 = require("./db");
const getRoomFromId = async (id) => {
    const { data, error } = await db_1.supabaseAdmin
        .from("ei_typebomb_rooms")
        .select("*")
        .eq("id", id)
        .maybeSingle();
    if (error) {
        console.error(error.message);
        return;
    }
    if (!data) {
        return;
    }
    return {
        id: data.id,
        title: data.title,
        userId: data.user_id,
        explanation: data.explanation,
        maxPlayers: data.max_players,
        password: data.password,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        words: data.words,
    };
};
exports.getRoomFromId = getRoomFromId;
