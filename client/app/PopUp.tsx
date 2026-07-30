"use client";

import Button from "@/components/ui/Button";
import { useEffect, useState } from "react";

const COOKIE_KEY = "cookie-consent";

export default function PopUp() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const accepted = localStorage.getItem(COOKIE_KEY);

        if (!accepted) {
            const timer = setTimeout(() => setOpen(true), 500);
            return () => clearTimeout(timer);
        }
    }, []);

    const accept = () => {
        localStorage.setItem(COOKIE_KEY, "true");
        setOpen(false);
    };

    if (!open) return null;

    return (
        <div className="fixed inset-x-0 bottom-10 z-2 flex justify-center px-4">
            <div className="w-full max-w-2xl rounded-2xl bg-(--color-background-secondary) p-2">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div className="px-2 py-1 flex flex-col gap-2">
                        <h2
                            className="text-lg font-semibold w-fit"
                            data-cursor="text"
                        >
                            Cookie Notice
                        </h2>
                        <p data-cursor="text">
                            This website uses cookies. By continuing to use this
                            website, you agree to our use of cookies.
                        </p>
                    </div>

                    <Button variant="primary" onClick={accept}>
                        Accept
                    </Button>
                </div>
            </div>
        </div>
    );
}
