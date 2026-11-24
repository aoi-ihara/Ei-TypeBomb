import type { ReactNode } from "react";
import Header from "@/components/layout/Header";
import Navigation from "@/components/layout/Navigation";
import Sidebar, { type SidebarItem } from "@/components/layout/Sidebar";
import AccountSignOut from "@/components/account/settings/AccountSignOut";
import requireAccountUser from "./require-account-user";

const items: SidebarItem[] = [
    { label: "アプリ", iconName: "layoutGrid", href: "/account" },
    { label: "セキュリティ", iconName: "shield", href: "/account/security" },
];

export default async function Layout({ children }: { children: ReactNode }) {
    const user = await requireAccountUser();

    return (
        <>
            <Header />
            <Sidebar items={items} actions={<AccountSignOut user={user} />}>
                <Navigation>{children}</Navigation>
            </Sidebar>
        </>
    );
}
