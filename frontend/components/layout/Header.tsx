"use client";

import Image from "next/image";
import React from "react";
import Link from "next/link";

export default function Header({ children }: { children?: React.ReactNode }) {
    return (
        <header className="flex w-full shrink-0 items-center justify-between gap-4 px-4 py-4" data-navigation-header>
            <div className="flex min-w-0 flex-1 gap-4">
                <div className="min-w-0 rounded-lg" data-cursor="button">
                    <Link
                        className="flex min-w-0 items-center rounded-lg pr-3 duration-(--duration-etb) ease-etb transition-all active:scale-95"
                        href="/"
                    >
                        <picture className="shrink-0">
                            <source
                                media="(prefers-color-scheme: dark)"
                                srcSet="/icon-dark.png"
                            />
                            <Image
                                src="/icon-light.png"
                                alt="ETB"
                                className="rounded-lg"
                                width={36}
                                height={36}
                            />
                        </picture>
                        <span className="min-w-0 truncate font-extrabold text-xl">
                            {process.env.NEXT_PUBLIC_BETA_ENVIRONMENT! ===
                            "true"
                                ? "ETB Beta"
                                : "ETB"}
                        </span>
                    </Link>
                </div>
            </div>
            {children}
        </header>
    );
}
