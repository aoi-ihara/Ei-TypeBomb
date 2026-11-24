import test from "node:test";
import assert from "node:assert/strict";
import { createSpeechLanguageResolver } from "../../lib/speech-language";

const strong = (lang: string) => [{ lang, accuracy: 0.9 }, { lang: "en", accuracy: 0.1 }];
const model = (text: string) => {
    if (text === "chat") return [{ lang: "en", accuracy: 0.4 }, { lang: "fr", accuracy: 0.38 }];
    if (text.includes("bonjour") || text.includes("fromage")) return strong("fr");
    if (text.includes("Guten Morgen")) return strong("de");
    return [];
};

test("script detection and independent room context", () => {
    const resolve = createSpeechLanguageResolver([
        { prompt: "こんにちは", answer: "bonjour" },
        { prompt: "ありがとう", answer: "fromage" },
        { prompt: "猫", answer: "chat" },
    ], model);
    assert.equal(resolve("猫", "prompt", "en-US"), "ja-JP");
    assert.equal(resolve("chat", "answer", "en-US"), "fr-FR");
    assert.equal(resolve("Guten Morgen", "answer", "en-US"), "de-DE");
    assert.equal(resolve("감사합니다", "answer"), "ko-KR");
    assert.equal(resolve("こんにちは", "answer"), "ja-JP");
});

test("ambiguous text uses browser locale without a usable room prior", () => {
    const resolve = createSpeechLanguageResolver([], () => []);
    assert.equal(resolve("?", "prompt", "fr-CA"), "fr-CA");
    assert.equal(resolve("猫", "answer", "ja-JP"), "ja-JP");
    assert.equal(resolve("猫", "answer", "zh-TW"), "zh-TW");
    assert.equal(resolve("?", "answer"), "en-US");
});

test("room context and detection are lazy and cached", () => {
    let calls = 0;
    const resolve = createSpeechLanguageResolver([{ prompt: "a", answer: "bonjour" }], text => {
        calls++;
        return model(text);
    });
    assert.equal(calls, 0);
    assert.equal(resolve("bonjour", "answer"), "fr-FR");
    const before = calls;
    assert.equal(resolve("bonjour", "answer"), "fr-FR");
    assert.equal(calls, before);
});

test("real local detector recognizes full multilingual phrases", () => {
    const resolve = createSpeechLanguageResolver([]);
    assert.equal(resolve("This is a beautiful English sentence.", "answer"), "en-US");
    assert.equal(resolve("Bonjour, comment allez-vous aujourd'hui ?", "answer"), "fr-FR");
    assert.equal(resolve("これは日本語の文章です。", "answer"), "ja-JP");
});
