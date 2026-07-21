"use client";

import Link from "next/link";

export function Footer() {
    return (
        <div className="flex w-fit">
            <div data-cursor="text pointer-events-none">
                © 2026 vgnz93hs. All rights reserved.
            </div>
            <div
                data-cursor="button"
                data-cursor-shape="1"
                className="rounded-xs px-0.5"
            >
                <Link
                    href="https://vgnz93hs.com/terms-of-use"
                    className="underline active:no-underline active:scale-95 transition-all duration-200 ease-out flex"
                >
                    Terms of Use
                </Link>
            </div>
        </div>
    );
}
