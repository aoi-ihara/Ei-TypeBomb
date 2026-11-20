"use client";

import Image from "next/image";
import React from "react";
import Link from "next/link";

export default function Header({ children }: { children?: React.ReactNode }) {
    return (
        <header className="flex w-full shrink-0 items-center justify-between gap-4 px-4 py-4">
            <div className="flex min-w-0 flex-1 gap-4">
                <div className="shrink-0 rounded-lg" data-cursor="button">
                    <Link
                        className="flex w-max shrink-0 items-center gap-2 whitespace-nowrap rounded-lg pr-3 duration-(--duration-etb) ease-etb transition-all active:scale-95"
                        href="/"
                    >
                        <Image
                            src="/favicon.svg"
                            alt="page-logo"
                            className="shrink-0 rounded-lg"
                            width={36}
                            height={36}
                        />
                        <span className="whitespace-nowrap font-extrabold">
                            {process.env.NEXT_PUBLIC_BETA_ENVIRONMENT! ===
                            "true"
                                ? "Ei-TypeBomb Beta"
                                : "Ei-TypeBomb"}
                        </span>
                    </Link>
                </div>
            </div>
            {children}
        </header>
    );
}
