import AccountSettings from "@/components/account/settings/AccountSettings";
import { getUserDetails } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function Page() {
    const user = await getUserDetails();
    if (!user) redirect("/sign-in");
    return <AccountSettings user={user} />;
}
