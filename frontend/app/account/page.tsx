import Header from "@/components/layout/Header";
import AccountDetails from "@/components/account/AccountDetails";
import { getUserDetails } from "@/lib/auth/session";
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
