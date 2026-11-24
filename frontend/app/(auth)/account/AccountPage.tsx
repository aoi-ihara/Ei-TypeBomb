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
    await requireAccountUser();

    return (
        <Shell title={title} size="medium" showHeader={false} back={backLink}>
            {children}
        </Shell>
    );
}
