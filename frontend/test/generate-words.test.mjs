import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

function load(words, remotePrompt) {
    const calls = [];
    const source = ts.transpileModule(
        readFileSync(new URL("../lib/AI/generateWords.ts", import.meta.url), "utf8"),
        { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText;
    const exports = {};
    vm.runInNewContext(source, {
        exports,
        require(id) {
            if (id === "server-only") return {};
            if (id === "zod") return { z };
            if (id === "@posthog/ai") return {
                Prompts: class {
                    async get(name, { fallback }) {
                        return { name, version: 1, prompt: remotePrompt ?? fallback,
                            config: { length: words.length } };
                    }
                    compile(prompt, values) {
                        return prompt.replaceAll("{{length}}", values.length)
                            .replaceAll("{{theme}}", values.theme);
                    }
                },
            };
            if (id === "./gemini") return {
                posthog: {},
                gemini: { models: { async generateContent(request) {
                    calls.push(request);
                    return { text: JSON.stringify({ words }) };
                } } },
            };
            throw new Error(id);
        },
    });
    return { generate: exports.generateWords, calls };
}

for (const remote of [false, true]) {
    test(`language rules reach Gemini with ${remote ? "legacy remote" : "fallback"} prompt`, async () => {
        const words = [{ jp: "猫", en: "chat" }, { jp: "犬", en: "chien" }];
        const { generate, calls } = load(words, remote
            ? "Generate exactly {{length}} English words. Theme: {{theme}}" : undefined);
        const theme = "問題は日本語、回答はフランス語で動物";
        assert.deepEqual(JSON.parse(JSON.stringify(await generate(theme))), words);
        const request = calls[0];
        assert.ok(request.contents.includes(theme));
        assert.match(request.config.systemInstruction, /Choose the question language and the answer language independently/);
        assert.match(request.config.systemInstruction, /take precedence over conflicting language/);
        assert.match(request.config.systemInstruction, /default to English answers/);
        assert.equal(request.config.responseJsonSchema.properties.words.minItems, 2);
        if (!remote) assert.doesNotMatch(request.contents, /Generate exactly 2 English words/);
    });
}

test("non-Latin scripts and accents survive response validation without conversion", async () => {
    for (const words of [
        [{ jp: "Hello", en: "안녕하세요" }],
        [{ jp: "ありがとう", en: "شكراً" }],
        [{ jp: "学校", en: "école" }],
        [{ jp: "うれしい", en: "喜ばしい" }],
    ]) {
        const { generate } = load(words);
        assert.deepEqual(JSON.parse(JSON.stringify(await generate("語彙の練習"))), words);
    }
});
