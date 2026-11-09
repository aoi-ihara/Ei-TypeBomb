import Header from "@/components/layout/Header";
import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import AccountDetails from "@/components/account/AccountDetails";
import { getUserDetails } from "@/lib/auth/session";
import { isOAuthEnabled } from "@/lib/auth/oauth-config";
import { signOut } from "@/lib/auth/sign-out";
import { redirect } from "next/navigation";
export default async function Page() {
    const user = await getUserDetails();
    if (!user) redirect("/sign-in");
    return (
        <>
            <Header />
            <Shell title="アカウント" size="large">
                <p className="break-all w-full font-mono">{user.email}</p>
                {isOAuthEnabled() ? (
                    <>
                        <Button href="https://hub.vgnz93hs.com/">
                            RC Hubでアカウントを管理
                        </Button>
                        <p>サインアウトするとETBのセッションが終了します。</p>
                        <form action={signOut}>
                            <Button type="submit" variant="danger">
                                サインアウト
                            </Button>
                        </form>
                    </>
                ) : (
                    <AccountDetails />
                )}
            </Shell>
        </>
    );
}
