"use client";

import { useEffect } from "react";
import Shell from "@/components/layout/Shell";

export default function OAuthLoginPage() {
    useEffect(() => {
        // Use a document navigation: OAuth redirects must not become RSC fetches.
        window.location.replace("/auth/start" + window.location.search);
    }, []);

    return (
        <Shell title="サインイン">
            <p className="text-sm">RC Hubへ移動しています…</p>
            <a className="text-sm underline" href="/auth/start">
                RC Hubでサインイン
            </a>
        </Shell>
    );
}
