"use client";

import Shell from "@/components/layout/Shell";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth/sign-in";
import { PopUp } from "@/components/ui/PopUp";
import { Turnstile } from "@marsidev/react-turnstile";
import { useEffect } from "react";
import { getSession } from "@/lib/auth/session";

export default function SignInPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [turnstile, setTurnstile] = useState(false);
    const [error, setError] = useState("");

    const router = useRouter();

    useEffect(() => {
        const getSessionInfo = async () => {
            const session = await getSession();
            if (session) router.push("/");
        };

        getSessionInfo();
    }, [router]);

    const handleSignIn = async (
        email: string,
        password: string,
        turnstileToken: string,
    ) => {
        const data = await signIn(email, password, turnstileToken);

        if (data) {
            setError(data);
        }

        setLoading(false);
    };

    return (
        <Shell title="Sign In">
            <Input
                value={email}
                font="mono"
                type="email"
                label="Email"
                disabled={loading}
                onChange={(e) => {
                    setEmail(e.target.value);
                }}
            />
            <Input
                value={password}
                font="mono"
                type="password"
                label="Password"
                disabled={loading}
                onChange={(e) => {
                    setPassword(e.target.value);
                }}
            />
            {error && <a className="text-red-500">{error}</a>}
            <Button
                onClick={() => {
                    setLoading(true);
                    setError("");
                    setTurnstile(true);
                }}
                padding="middle"
                loading={loading}
                className="w-full"
                variant="primary"
            >
                Sign In
            </Button>
            <Button className="w-full" onClick={() => router.push("/sign-up")}>
                Create rcAccount
            </Button>
            <PopUp show={turnstile}>
                <Turnstile
                    siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
                    onSuccess={(turnstileToken: string) => {
                        setTurnstile(false);
                        handleSignIn(email, password, turnstileToken);
                    }}
                />
            </PopUp>
        </Shell>
    );
}
