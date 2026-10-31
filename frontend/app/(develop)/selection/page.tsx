"use client";

import { useState } from "react";
import Shell from "@/components/layout/Shell";
import Selection from "@/components/ui/Selection";

export default function Page() {
    const [selection, setSelection] = useState(0);
    const items = ["公開", "限定公開", "非公開"];

    return (
        <Shell title="DEV / Selection">
            <Selection
                items={items}
                selection={selection}
                onSelected={setSelection}
            />
        </Shell>
    );
}
