import Shell from "@/components/layout/Shell";
import OAuthConsent from "@/components/account/OAuthConsent";
import { getUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OAuthConsentPage({
    searchParams,
}: {
    searchParams: Promise<{ uid?: string | string[] }>;
}) {
    const { uid } = await searchParams;
    if (typeof uid !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(uid)) {
        return (
            <Shell title="認証に失敗しました" size="small">
                <p data-cursor="text">リクエストを確認できませんでした。</p>
            </Shell>
        );
    }
    if (!(await getUser())) {
        redirect(
            "/sign-in?next=" +
                encodeURIComponent("/api/oauth/interaction/" + uid),
        );
    }

    return <OAuthConsent uid={uid} />;
}
