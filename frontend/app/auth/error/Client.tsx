"use client";

import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";

export default function Client({ message }: { message: string }) {
    const router = useRouter();
    return (
        <Shell title="サインイン" size="small">
            <p className="w-full text-center" role="alert" data-cursor="text">
                {message}
            </p>
            <Button
                onClick={() => { startNavigationProgress(); router.push("/auth/sign-in"); }}
                className="w-full"
                iconName="rotateCcw"
            >
                もう一度試す
            </Button>
            <Button
                onClick={() => { startNavigationProgress(); router.push("/"); }}
                variant="text"
                iconName="home"
            >
                ホームに戻る
            </Button>
        </Shell>
    );
}
