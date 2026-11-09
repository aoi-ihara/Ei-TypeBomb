import { redirect } from "next/navigation";
import { safeReturnPath } from "@/lib/auth/oauth-config";

/** Legacy sign-in URL now opens ETB's own sign-in form. */
export default async function Page({
    searchParams,
}: {
    searchParams: Promise<{ next?: string }>;
}) {
    const { next } = await searchParams;
    redirect(next ? "/sign-in?next=" + encodeURIComponent(safeReturnPath(next)) : "/sign-in");
}
