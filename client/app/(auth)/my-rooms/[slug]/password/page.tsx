"use client";

import { useState, use } from "react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Shell from "@/components/layout/Shell";
import { updateRoomFromId } from "@/lib/room/update";
import { Room } from "@/type";
import { useRouter } from "next/navigation";

export default function Page({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = use(params);

    const router = useRouter();

    const [newPassword, setNewPassword] = useState("");
    const [error, setError] = useState("");

    const clearPassword = async () => {
        const error = await updateRoomFromId({ id: slug, password: "" });

        if (error) setError(error);
        else router.push(`/my-rooms/${slug}`);
    };

    const handleUpdate = async () => {
        if (!slug) {
            console.error("Room ID is required.");
            return;
        }

        console.log(slug);

        const request: Room = {
            id: slug,
            password: newPassword,
        };

        const error = await updateRoomFromId(request);

        if (error) setError(error);
        else router.push(`/my-rooms/${slug}`);
    };

    return (
        <Shell title="Change Room Password" className="flex flex-col gap-4">
            <Input
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                label="New Room Password"
                type="password"
            />

            <Button
                padding="large"
                variant="primary"
                onClick={() => handleUpdate()}
                className="w-full"
            >
                Change
            </Button>
            {error && <div className="text-red-500">{error}</div>}
            <Button
                padding="large"
                className="w-full"
                onClick={() => clearPassword()}
            >
                Clear Password
            </Button>
        </Shell>
    );
}
