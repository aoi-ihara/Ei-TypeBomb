"use client";

import { useEffect } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import posthog from "posthog-js";
import Button from "@/components/ui/Button";
import { signOut } from "@/lib/auth/sign-out";
import {
    identifyPostHogUser,
    type PostHogIdentityUser,
} from "@/lib/analytics/posthog-identity";

export default function AccountSignOut({
    user,
}: {
    user: PostHogIdentityUser;
}) {
    const router = useRouter();

    useEffect(() => {
        identifyPostHogUser(user);
    }, [user]);

    const handleSignOut = async () => {
        posthog.reset();
        try {
            await signOut();
            router.refresh();
        } catch (error) {
            unstable_rethrow(error);
            identifyPostHogUser(user);
            throw error;
        }
    };

    return (
        <Button
            variant="danger"
            onClick={handleSignOut}
            className="w-fit shrink-0 sm:w-full"
            iconName="logOut"
            padding="small"
            alignment="left"
        >
            サインアウト
        </Button>
    );
}
