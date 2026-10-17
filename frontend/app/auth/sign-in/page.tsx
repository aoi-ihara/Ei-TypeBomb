"use client";

import Shell from "@/components/layout/Shell";
import { useEffect } from "react";

export default function OAuthLoginPage() {
    useEffect(() => {
        window.location.replace("/auth/start" + window.location.search);
    }, []);

    return <Shell title="サインイン" loading={true} />;
}
