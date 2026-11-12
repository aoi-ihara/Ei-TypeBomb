"use client";

import Image from "next/image";
import React from "react";
import Link from "next/link";

export default function Header({ children }: { children?: React.ReactNode }) {
    return (
        <header className="flex shrink-0 top-0 left-0 w-full justify-between px-4 py-4">
            <div className="flex gap-4">
                <div className="rounded-lg" data-cursor="button">
                    <Link
                        className="items-center rounded-lg gap-2 flex pr-3 duration-(--duration-etb) ease-etb transition-all active:scale-95"
                        href="/"
                    >
                        <Image
                            src="/favicon.svg"
                            alt="page-logo"
                            className="rounded-lg"
                            width={36}
                            height={36}
                        />
                        <span className="font-extrabold flex">Ei-TypeBomb</span>
                    </Link>
                </div>
            </div>
            {children}
        </header>
    );
}
