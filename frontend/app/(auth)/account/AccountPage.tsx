import type { ReactNode } from "react";
import Shell from "@/components/layout/Shell";
import requireAccountUser from "./require-account-user";

export default async function AccountPage({
    title,
    backLink,
    children,
}: {
    title: string;
    backLink?: string;
    children: ReactNode;
}) {
    // The persistent layout may be reused on client navigation.
    await requireAccountUser();

    return (
        <Shell title={title} size="medium" showHeader={false} backLink={backLink}>
            <div className="w-full px-4 sm:px-0">{children}</div>
        </Shell>
    );
}
