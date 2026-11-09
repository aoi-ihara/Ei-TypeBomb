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
            <AccountDetails />
        </>
    );
}
