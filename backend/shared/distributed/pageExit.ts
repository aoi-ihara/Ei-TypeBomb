import { ClientError } from "../validation";

/** Beacon credentials authorize one page session in one room incarnation. */
export function parsePageExit(data: unknown) {
    if (!data || typeof data !== "object")
        throw new ClientError("退出情報が不正です。");
    const { jwtToken, sessionToken, expectedInstance, connectionId } =
        data as Record<string, unknown>;
    if (
        typeof jwtToken !== "string" ||
        !jwtToken.length ||
        jwtToken.length > 4096 ||
        typeof sessionToken !== "string" ||
        !sessionToken.length ||
        sessionToken.length > 4096 ||
        typeof connectionId !== "string" ||
        !connectionId.length ||
        connectionId.length > 100 ||
        typeof expectedInstance !== "string" ||
        !expectedInstance.length ||
        expectedInstance.length > 100
    )
        throw new ClientError("署名付きセッションとルーム識別子が必要です。");
    return { jwtToken, sessionToken, expectedInstance, connectionId };
}
