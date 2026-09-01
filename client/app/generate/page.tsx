"use client";

import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { generateWordsWithGemini } from "@/lib/AI/generateWords";
import { useState } from "react";

export default function Generate() {
    const [prompt, setPrompt] = useState("");
    const [response, setResponse] = useState("");

    return (
        <div>
            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <Button
                onClick={async () => {
                    const response = await generateWordsWithGemini(prompt);

                    console.log(response);

                    setResponse(response ?? "Error!");
                }}
            >
                Generate
            </Button>

            {response}
        </div>
    );
}
