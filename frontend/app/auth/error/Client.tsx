"use client";

import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import Header from "@/components/layout/Header";

export default function Client({ message }: { message: string }) {
    return (
        <>
            <Header />
            <Shell title="サインイン" size="small">
                <p
                    className="w-full text-center"
                    role="alert"
                    data-cursor="text"
                >
                    {message}
                </p>
                <Button
                    href="/auth/sign-in"
                    className="w-full"
                    iconName="rotateCcw"
                    variant="primary"
                >
                    もう一度試す
                </Button>
                <Button href="/" className="w-full" iconName="home">
                    ホームに戻る
                </Button>
            </Shell>
        </>
    );
}
