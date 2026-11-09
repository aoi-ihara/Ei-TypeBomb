"use server";

import { isOAuthEnabled } from "@/lib/auth/oauth-config";
import { createClient } from "@/lib/db/server";

type AuthorizedApp = { clientId: string; name: string; url: string | null };

// Only navigate to verified application homepages; callback URIs are not homepages.
const APP_HOME_URLS: Record<string, string> = {
    "Ei-TypeBomb": "https://ei-typebomb.vgnz93hs.com",
};

export async function listAuthorizedApps(): Promise<{
    apps: AuthorizedApp[];
    error: string | null;
}> {
    if (isOAuthEnabled())
        return { apps: [], error: "RC Hubで連携アプリを管理してください。" };
    const supabase = await createClient();
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
        return { apps: [], error: "ログイン状態を確認できませんでした。" };
    }
    const { data, error } = await supabase.auth.oauth.listGrants();
    if (error) {
        return { apps: [], error: "連携済みアプリを取得できませんでした。" };
    }

    const apps = (data ?? [])
        .filter((grant) => Boolean(grant.client?.id))
        .map((grant) => ({
            clientId: grant.client.id,
            name: grant.client.name || "名前のないアプリ",
            url: APP_HOME_URLS[grant.client.name] ?? null,
        }));

    return { apps, error: null };
}

export async function revokeAuthorizedApp(
    clientId: string,
): Promise<{ error: string | null }> {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(clientId)) {
        return { error: "アプリIDが正しくありません。" };
    }

    if (isOAuthEnabled())
        return { error: "RC Hubで連携アプリを管理してください。" };
    const supabase = await createClient();
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
        return { error: "ログイン状態を確認できませんでした。" };
    }

    // Only allow removing an existing grant belonging to this account.
    const { data: grants, error: listError } =
        await supabase.auth.oauth.listGrants();
    if (listError) return { error: "連携状態を確認できませんでした。" };
    if (!(grants ?? []).some((grant) => grant.client.id === clientId)) {
        return { error: "指定された連携は見つかりませんでした。" };
    }

    const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
    if (error) return { error: "連携の解除に失敗しました。" };
    return { error: null };
}
