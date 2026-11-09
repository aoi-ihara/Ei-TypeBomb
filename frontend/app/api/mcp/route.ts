import { getEtbUrl } from "@/lib/config/base-url";
import {
    authenticateMcpRequest,
    unauthorizedMcpResponse,
} from "@/lib/mcp/oauth";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/server";
import { hashPassword } from "@/lib/auth/hash";
import {
    validateExplanation,
    validateGameDuration,
    validateItems,
    validateLink,
    validateMaxPlayers,
    validatePassword,
    validateTitle,
} from "@/lib/auth/validator";
import type { Room, View } from "@/type";
import { getRoomCollectionsForUser } from "@/lib/room/list-data";
import { selectRoomsForView } from "@/lib/room/list-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
    PROTOCOL_VERSION,
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
]);
const MAX_BODY_BYTES = 32 * 1024;
const ROOM_FIELDS =
    "id, link, title, explanation, max_players, bomb_count, game_duration, visibility, items, password, created_at, updated_at";

type JsonRpcId = string | number;
type JsonRecord = Record<string, unknown>;

type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: JsonRecord;
    isError?: boolean;
};

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRpc(
    id: JsonRpcId,
    result: unknown,
    protocolVersion = PROTOCOL_VERSION,
) {
    return NextResponse.json(
        { jsonrpc: "2.0", id, result },
        {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers":
                    "Mcp-Protocol-Version, WWW-Authenticate",
                "Cache-Control": "no-store",
                "Mcp-Protocol-Version": protocolVersion,
            },
        },
    );
}

function jsonRpcError(
    id: JsonRpcId | null,
    code: number,
    message: string,
    status = 200,
) {
    return NextResponse.json(
        { jsonrpc: "2.0", id, error: { code, message } },
        {
            status,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": "WWW-Authenticate",
                "Cache-Control": "no-store",
            },
        },
    );
}

function toolResult(value: JsonRecord): ToolResult {
    return {
        content: [{ type: "text", text: JSON.stringify(value) }],
        structuredContent: value,
    };
}

function toolError(message: string): ToolResult {
    return {
        content: [{ type: "text", text: message }],
        isError: true,
    };
}

const itemSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        type: { const: "typed_recall" },
        prompt: { type: "string" },
        answer: { type: "string" },
    },
    required: ["id", "type", "prompt", "answer"],
    additionalProperties: false,
};

const roomProperties = {
    title: { type: "string", description: "ルーム名（64文字以内）" },
    explanation: { type: "string", description: "ルームの説明（512文字以内）" },
    visibility: {
        type: "string",
        enum: ["public", "unlisted", "private"],
        description: "公開範囲",
    },
    max_players: { type: "integer", minimum: 2, maximum: 16 },
    bomb_count: { type: "integer", minimum: 1, maximum: 4 },
    game_duration: { type: "integer", minimum: 1, maximum: 2147473 },
    password: { type: "string", minLength: 8, maxLength: 64 },
    link: { type: "string", minLength: 3, maxLength: 64 },
    items: {
        type: "array",
        maxItems: 512,
        items: itemSchema,
        description: "ルームに登録する問題",
    },
};

const tools = [
    {
        name: "list_rooms",
        description:
            "おすすめ・自分のルーム・保存済みルームを一覧取得します。view省略時は自分のルーム。おすすめは公開ルームのみ、保存済みはWeb版と同じ閲覧可能なルームのみ返します。",
        inputSchema: {
            type: "object",
            properties: {
                view: {
                    type: "string",
                    enum: ["recommended", "mine", "saved"],
                    description:
                        "recommended=おすすめ、mine=自分のルーム、saved=保存済み。省略時はmine。",
                },
                limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100,
                    description: "1回に返す件数（省略時50、最大100）",
                },
                offset: {
                    type: "integer",
                    minimum: 0,
                    description: "先頭からスキップする件数（省略時0）",
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: "create_room",
        description:
            "認証中のユーザーのEi-TypeBombルームを作成します。作成後はEi-TypeBombで通常どおり利用できます。",
        inputSchema: {
            type: "object",
            properties: roomProperties,
            additionalProperties: false,
        },
    },
    {
        name: "get_room",
        description:
            "認証中のユーザーが所有するルームの設定を取得します。ルームIDまたはリンクを指定できます。",
        inputSchema: {
            type: "object",
            properties: {
                room_identifier: {
                    type: "string",
                    description: "ルームIDまたは共有リンク",
                },
            },
            required: ["room_identifier"],
            additionalProperties: false,
        },
    },
    {
        name: "update_room",
        description:
            "認証中のユーザーが所有するルームの設定を更新します。指定した項目だけを変更します。",
        inputSchema: {
            type: "object",
            properties: {
                room_id: { type: "string", description: "変更するルームのID" },
                ...roomProperties,
            },
            required: ["room_id"],
            additionalProperties: false,
        },
    },
];

function validateRoomPatch(input: JsonRecord): {
    patch: JsonRecord;
    error: string | null;
} {
    const patch: JsonRecord = {};
    const checks: Array<[string, (value: unknown) => string | null, string]> = [
        [
            "title",
            (v) =>
                typeof v === "string"
                    ? validateTitle(v)
                    : "ルーム名が不正です。",
            "title",
        ],
        [
            "explanation",
            (v) =>
                typeof v === "string"
                    ? validateExplanation(v)
                    : "説明が不正です。",
            "explanation",
        ],
        [
            "max_players",
            (v) =>
                typeof v === "number" && Number.isInteger(v)
                    ? validateMaxPlayers(v)
                    : "最大プレイヤー数が不正です。",
            "max_players",
        ],
        [
            "game_duration",
            (v) =>
                typeof v === "number"
                    ? validateGameDuration(v)
                    : "ゲーム時間が不正です。",
            "game_duration",
        ],
        [
            "link",
            (v) =>
                typeof v === "string" ? validateLink(v) : "リンクが不正です。",
            "link",
        ],
    ];

    for (const [key, validate, column] of checks) {
        if (input[key] === undefined) continue;
        const error = validate(input[key]);
        if (error) return { patch, error };
        patch[column] = input[key];
    }

    if (input.bomb_count !== undefined) {
        const value = input.bomb_count;
        if (
            typeof value !== "number" ||
            !Number.isInteger(value) ||
            value < 1 ||
            value > 4 ||
            (typeof input.max_players === "number" && value > input.max_players)
        ) {
            return {
                patch,
                error: "爆弾数は1〜4個、かつ最大プレイヤー数以下にしてください。",
            };
        }
        patch.bomb_count = value;
    }

    if (input.visibility !== undefined) {
        if (
            !["public", "unlisted", "private"].includes(
                String(input.visibility),
            )
        ) {
            return { patch, error: "公開設定が正しくありません。" };
        }
        patch.visibility = input.visibility;
        patch.is_public = input.visibility === "public";
        if (input.visibility === "public" || input.visibility === "unlisted") {
            patch.password = null;
        }
    }

    if (input.items !== undefined) {
        if (!Array.isArray(input.items))
            return { patch, error: "問題一覧が不正です。" };
        const error = validateItems(input.items as Room["items"]);
        if (error) return { patch, error };
        patch.items = input.items;
    }

    if (input.password !== undefined) {
        if (input.password !== null && typeof input.password !== "string") {
            return { patch, error: "パスワードが不正です。" };
        }
        if (typeof input.password === "string" && input.password.length > 0) {
            const error = validatePassword(input.password);
            if (error) return { patch, error };
            patch.password = input.password;
        } else {
            patch.password = null;
        }
    }

    if (input.visibility === "public" || input.visibility === "unlisted") {
        patch.password = null;
    }

    return { patch, error: null };
}

function presentRoom(room: JsonRecord): JsonRecord {
    const { password, ...safeRoom } = room;
    return { ...safeRoom, has_password: Boolean(password) };
}

async function callTool(
    name: string,
    args: JsonRecord,
    userId: string,
): Promise<ToolResult> {
    if (name === "list_rooms") {
        const view = args.view ?? "mine";
        if (view !== "recommended" && view !== "mine" && view !== "saved") {
            return toolError(
                "viewはrecommended、mine、savedのいずれかを指定してください。",
            );
        }
        const limit = args.limit ?? 50;
        const offset = args.offset ?? 0;
        if (
            typeof limit !== "number" ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100
        ) {
            return toolError("limitは1〜100の整数を指定してください。");
        }
        if (
            typeof offset !== "number" ||
            !Number.isSafeInteger(offset) ||
            offset < 0
        ) {
            return toolError("offsetは0以上の整数を指定してください。");
        }

        const { publicRooms, myRooms, savedRoomIds } =
            await getRoomCollectionsForUser(userId, { strict: true });
        const selected = selectRoomsForView({
            view: view as View,
            publicRooms,
            myRooms,
            savedRoomIds,
            currentUserId: userId,
        });
        const ownIds = new Set(myRooms.map((room) => room.id));
        const savedIds = new Set(savedRoomIds);
        return toolResult({
            view,
            total: selected.length,
            offset,
            limit,
            next_offset:
                offset + limit < selected.length ? offset + limit : null,
            rooms: selected.slice(offset, offset + limit).map((room) => ({
                id: room.id,
                link: room.link ?? room.id,
                title: room.title ?? null,
                explanation: room.explanation ?? null,
                visibility: room.visibility ?? "public",
                item_count: room.itemCount ?? 0,
                max_players: room.maxPlayers ?? 2,
                bomb_count: room.bombCount ?? null,
                game_duration: room.gameDuration ?? 20,
                created_at: room.createdAt ?? null,
                updated_at: room.updatedAt ?? null,
                is_owner: ownIds.has(room.id),
                is_saved: savedIds.has(room.id),
                url: getEtbUrl(`/${encodeURIComponent(room.link ?? room.id)}`),
            })),
        });
    }

    const supabase = await createAdminClient();

    if (name === "create_room") {
        const { patch, error } = validateRoomPatch(args);
        if (error) return toolError(error);

        const id = crypto.randomUUID();
        const insert: JsonRecord = {
            id,
            user_id: userId,
            link: id,
            items: [],
            visibility: "unlisted",
            ...patch,
        };
        if (
            insert.visibility === "public" ||
            insert.visibility === "unlisted"
        ) {
            insert.password = null;
        } else if (typeof insert.password === "string") {
            insert.password = await hashPassword(insert.password);
        }

        const { data, error: insertError } = await supabase
            .from("ei_typebomb_rooms")
            .insert(insert)
            .select(ROOM_FIELDS)
            .single();

        if (insertError || !data) {
            console.error("MCP room creation failed", insertError?.code);
            return toolError(
                "ルームを作成できませんでした。入力内容と設定を確認してください。",
            );
        }
        return toolResult({
            room: presentRoom(data as unknown as JsonRecord),
            url: getEtbUrl(`/${data.link}`),
        });
    }

    if (name === "get_room") {
        const identifier = args.room_identifier;
        if (typeof identifier !== "string" || !identifier.trim()) {
            return toolError("room_identifierを指定してください。");
        }
        // The id column is UUID-typed, while custom room links are arbitrary strings.
        // Avoid sending non-UUID links to the id filter (which causes a Postgres cast error).
        const isUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                identifier,
            );
        let room: JsonRecord | null = null;

        if (isUuid) {
            const { data, error } = await supabase
                .from("ei_typebomb_rooms")
                .select(ROOM_FIELDS)
                .eq("user_id", userId)
                .eq("id", identifier)
                .maybeSingle();
            if (error) {
                console.error("MCP room lookup by id failed", error.code);
                return toolError(
                    "ルームが見つからないか、アクセス権限がありません。",
                );
            }
            if (data) room = data as unknown as JsonRecord;
        }

        if (!room) {
            const { data, error } = await supabase
                .from("ei_typebomb_rooms")
                .select(ROOM_FIELDS)
                .eq("user_id", userId)
                .eq("link", identifier)
                .maybeSingle();
            if (error) {
                console.error("MCP room lookup by link failed", error.code);
                return toolError(
                    "ルームが見つからないか、アクセス権限がありません。",
                );
            }
            if (data) room = data as unknown as JsonRecord;
        }

        if (!room)
            return toolError(
                "ルームが見つからないか、アクセス権限がありません。",
            );
        return toolResult({ room: presentRoom(room) });
    }

    if (name === "update_room") {
        const roomId = args.room_id;
        if (typeof roomId !== "string" || !roomId.trim()) {
            return toolError("room_idを指定してください。");
        }
        const { ...input } = args;
        const { patch, error } = validateRoomPatch(input);
        if (error) return toolError(error);
        if (Object.keys(patch).length === 0)
            return toolError("変更する項目を1つ以上指定してください。");

        if (typeof patch.password === "string") {
            patch.password = await hashPassword(patch.password);
        }
        patch.updated_at = new Date().toISOString();

        const { data, error: updateError } = await supabase
            .from("ei_typebomb_rooms")
            .update(patch)
            .eq("id", roomId)
            .eq("user_id", userId)
            .select(ROOM_FIELDS)
            .maybeSingle();

        if (updateError || !data) {
            console.error("MCP room update failed", updateError?.code);
            return toolError("ルームが見つからないか、更新できませんでした。");
        }
        return toolResult({ room: presentRoom(data as unknown as JsonRecord) });
    }

    return toolError(`未対応のToolです: ${name}`);
}

export async function POST(request: NextRequest) {
    const principal = await authenticateMcpRequest(request);
    if (!principal) return unauthorizedMcpResponse(request);

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
        return NextResponse.json(
            { error: "Content-Type must be application/json" },
            { status: 415 },
        );
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
        return NextResponse.json(
            { error: "Request body too large" },
            { status: 413 },
        );
    }

    let body: unknown;
    try {
        body = JSON.parse(rawBody);
    } catch {
        return jsonRpcError(null, -32700, "Parse error", 400);
    }

    if (
        !isRecord(body) ||
        body.jsonrpc !== "2.0" ||
        typeof body.method !== "string"
    ) {
        return jsonRpcError(null, -32600, "Invalid Request", 400);
    }

    const id =
        typeof body.id === "string" || typeof body.id === "number"
            ? body.id
            : null;
    const isNotification = !("id" in body);

    if (isNotification) {
        return new NextResponse(null, {
            status: 202,
            headers: { "Cache-Control": "no-store" },
        });
    }
    if (id === null) {
        return jsonRpcError(null, -32600, "Invalid Request", 400);
    }

    if (body.method === "initialize") {
        const params = isRecord(body.params) ? body.params : {};
        const requestedVersion = params.protocolVersion;
        const protocolVersion =
            typeof requestedVersion === "string" &&
            SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)
                ? requestedVersion
                : PROTOCOL_VERSION;
        return jsonRpc(
            id,
            {
                protocolVersion,
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: "ei-typebomb", version: "1.0.0" },
                instructions:
                    "Ei-TypeBombのMCPサーバーです。OAuthで認証されたユーザー本人のルームを作成・取得・編集でき、おすすめの公開ルームや保存済みの閲覧可能なルームも一覧取得できます。",
            },
            protocolVersion,
        );
    }

    if (body.method === "ping") return jsonRpc(id, {});

    if (body.method === "tools/list") {
        return jsonRpc(id, { tools });
    }

    if (body.method !== "tools/call") {
        return jsonRpcError(id, -32601, "Method not found");
    }

    const params = isRecord(body.params) ? body.params : {};
    if (typeof params.name !== "string") {
        return jsonRpcError(id, -32602, "Invalid params");
    }

    const args = isRecord(params.arguments) ? params.arguments : {};
    try {
        const result = await callTool(params.name, args, principal.userId);
        return jsonRpc(id, result);
    } catch (error) {
        console.error("MCP tool execution failed", error);
        return jsonRpc(id, toolError("処理中にエラーが発生しました。"));
    }
}

export async function GET(request: NextRequest) {
    const principal = await authenticateMcpRequest(request);
    if (!principal) return unauthorizedMcpResponse(request);

    return new NextResponse(null, {
        status: 405,
        headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
}

export async function DELETE(request: NextRequest) {
    const principal = await authenticateMcpRequest(request);
    if (!principal) return unauthorizedMcpResponse(request);

    return new NextResponse(null, {
        status: 405,
        headers: {
            "Access-Control-Allow-Origin": "*",
            Allow: "POST, OPTIONS",
            "Cache-Control": "no-store",
        },
    });
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
            "Access-Control-Allow-Headers":
                "Authorization, Content-Type, Accept, Mcp-Protocol-Version",
            "Access-Control-Expose-Headers":
                "Mcp-Protocol-Version, WWW-Authenticate",
            "Access-Control-Max-Age": "86400",
        },
    });
}
