"use client";

import Button from "@/components/ui/Button";
import Morph from "@/components/ui/Morph";
import { useState } from "react";

export default function Page() {
    const [open, setOpen] = useState(false);

    return (
        <div className="flex min-h-[80dvh] w-full items-center justify-center">
            <Morph
                state={open ? "last" : "first"}
                first={
                    <Button onClick={() => setOpen(true)}>これはボタン</Button>
                }
                last={
                    <div className="w-fit rounded-3xl bg-blue-200 p-8">
                        <h2>ポップアップ</h2>
                        <div className="mt-12 text-6xl">ポップ</div>
                        <Button
                            onClick={() => setOpen(false)}
                            className="mt-8 w-fit"
                        >
                            閉じる
                        </Button>
                    </div>
                }
            />
        </div>
    );
}
