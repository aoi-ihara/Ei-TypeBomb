"use client";

import { startNavigationProgress } from "@/lib/navigation-progress";
import Image from "next/image";
import { useRouter } from "next/navigation";
import React from "react";

export default function Header({ children }: { children?: React.ReactNode }) {
    const router = useRouter();

    return (
        <header className="flex shrink-0 top-0 left-0 w-full justify-between px-4 py-4">
            <div className="rounded-lg" data-cursor="button">
                <button
                    className="items-center rounded-lg overflow-clip flex pl-1 pr-3 duration-(--duration-etb) ease-etb transition-all active:scale-95"
                    onClick={() => {
                        startNavigationProgress();
                        router.push("/");
                    }}
                >
                    <Image
                        src="/favicon.svg"
                        alt="page-logo"
                        width={36}
                        height={36}
                    />
                    <span className="font-extrabold">Ei-TypeBomb</span>
                </button>
            </div>
            {children}
        </header>
    );
}
