import "server-only";

import { redirect } from "next/navigation";
import { getUserDetails } from "@/lib/auth/session";

export default async function requireAccountUser() {
    const user = await getUserDetails();
    if (!user) redirect("/sign-in");
    return user;
}
