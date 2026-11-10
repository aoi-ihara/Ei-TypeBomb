"use server";

import { getUser } from "@/lib/auth/session";
import { getMcpProvider } from "@/lib/mcp/authorization-server/provider";
import { OAuthStore, revokeGrant, withOAuthLock } from "@/lib/mcp/authorization-server/store";

type AuthorizedApp = { clientId: string; name: string; url: string | null };

function safeClientUrl(uri: unknown): string | null {
    if (typeof uri !== "string") return null;
    try {
        const url = new URL(uri);
        return url.protocol === "https:" && !url.username && !url.password
            ? url.href
            : null;
    } catch {
        return null;
    }
}

export async function listAuthorizedApps(): Promise<{
    apps: AuthorizedApp[];
    error: string | null;
}> {
    if (process.env.ETB_MCP_OAUTH_ENABLED !== "true") {
        return { apps: [], error: "MCP接続管理が無効です。" };
    }
    const user = await getUser();
    if (!user) return { apps: [], error: "サインインが必要です。" };

    try {
        return await withOAuthLock(async () => {
            const grants = await new OAuthStore("Grant").forAccount(user);
            const uniqueClients = new Set<string>();
            for (const grant of grants) {
                if (grant.accountId === user && typeof grant.clientId === "string" &&
                    typeof grant.jti === "string") {
                    uniqueClients.add(grant.clientId);
                }
            }
            const apps = await Promise.all([...uniqueClients].map(async (clientId) => {
                const client = await getMcpProvider().Client.find(clientId);
                return {
                    clientId,
                    name: client?.clientName || "名称未設定のアプリ",
                    url: safeClientUrl(client?.clientUri),
                };
            }));
            return { apps, error: null };
        });
    } catch {
        return { apps: [], error: "連携済みアプリを取得できませんでした。" };
    }
}

export async function revokeAuthorizedApp(clientId: string): Promise<{
    error: string | null;
}> {
    if (process.env.ETB_MCP_OAUTH_ENABLED !== "true") {
        return { error: "MCP接続管理が無効です。" };
    }
    const user = await getUser();
    if (!user) return { error: "サインインが必要です。" };
    if (typeof clientId !== "string" || !clientId || clientId.length > 512) {
        return { error: "接続先が正しくありません。" };
    }

    try {
        return await withOAuthLock(async () => {
            const grants = await new OAuthStore("Grant").forAccount(user);
            const related = grants.filter(
                (grant) =>
                    grant.accountId === user &&
                    grant.clientId === clientId &&
                    typeof grant.jti === "string",
            );
            if (related.length === 0) return { error: "接続が見つかりません。" };

            // Every historical grant for this client must be invalidated.
            for (const grant of related) {
                await revokeGrant(grant.jti as string);
            }
            return { error: null };
        });
    } catch {
        return { error: "連携の解除に失敗しました。" };
    }
}
