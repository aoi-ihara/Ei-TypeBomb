"use client";

import { useRouter } from "next/navigation";
import { Icon } from "../ui/Icon";
import { startNavigationProgress } from "@/lib/navigation-progress";

export default function BackButton() {
    const router = useRouter();

    return (
        <button
            onClick={() => {
                startNavigationProgress();
                router.back();
            }}
            className="duration-(--duration-etb) ease-etb p-3 flex active:scale-95"
        >
            <Icon name="arrowLeft" />
        </button>
    );
}
