"use client";

import Button from "@/components/ui/Button";
import Picker from "@/components/ui/Picker";
import Morph from "@/components/ui/Morph";
import { useState } from "react";

export default function Page() {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);

    return (
        <div className="flex min-h-[80dvh] w-full flex-col gap-12 items-center justify-center">
            <div className="flex items-center gap-6">
                <Picker
                    name="表示を選択"
                    items={["ホーム", "お気に入り", "アイコンなし"]}
                    itemIcons={["home", "heart", null]}
                    onSelected={setSelected}
                />
                <span data-picker-result>選択: {selected ?? "なし"}</span>
            </div>
            <Morph
                state={open}
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
