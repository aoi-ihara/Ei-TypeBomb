"use client";

import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { generateWordsAction } from "@/lib/AI/actions";
import { useState } from "react";

export default function Generate() {
    const [prompt, setPrompt] = useState("");
    const [response, setResponse] = useState("");

    return (
        <Shell title="Generate Words">
            <Input
                value={prompt}
                label="Theme"
                onChange={(e) => setPrompt(e.target.value)}
            />
            <Button
                onClick={async () => {
                    const response = await generateWordsAction(prompt);

                    console.log(response);

                    setResponse(response ?? "Error!");
                }}
                variant="primary"
                className="w-full"
            >
                Generate
            </Button>

            {response}
        </Shell>
    );
}
