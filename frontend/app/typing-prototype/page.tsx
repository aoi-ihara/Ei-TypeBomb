"use client";

import { useMemo, useRef, useState } from "react";

// The prototype deliberately does not change the game's answer validation.
// Each entry maps a roman-key sequence to one or more visible kana cells.
const ROMAJI: Record<string, string> = {
    a: "あ", i: "い", u: "う", e: "え", o: "お",
    ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ",
    sa: "さ", si: "し", shi: "し", su: "す", se: "せ", so: "そ",
    ta: "た", ti: "ち", chi: "ち", tu: "つ", tsu: "つ", te: "て", to: "と",
    na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の",
    ha: "は", hi: "ひ", hu: "ふ", fu: "ふ", he: "へ", ho: "ほ",
    ma: "ま", mi: "み", mu: "む", me: "め", mo: "も",
    ya: "や", yu: "ゆ", yo: "よ",
    ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ",
    wa: "わ", wo: "を", nn: "ん",
    ga: "が", gi: "ぎ", gu: "ぐ", ge: "げ", go: "ご",
    za: "ざ", zi: "じ", ji: "じ", zu: "ず", ze: "ぜ", zo: "ぞ",
    da: "だ", di: "ぢ", du: "づ", de: "で", do: "ど",
    ba: "ば", bi: "び", bu: "ぶ", be: "べ", bo: "ぼ",
    pa: "ぱ", pi: "ぴ", pu: "ぷ", pe: "ぺ", po: "ぽ",
    kya: "きゃ", kyu: "きゅ", kyo: "きょ",
    sya: "しゃ", syu: "しゅ", syo: "しょ",
    sha: "しゃ", shu: "しゅ", sho: "しょ",
    tya: "ちゃ", tyu: "ちゅ", tyo: "ちょ",
    cha: "ちゃ", chu: "ちゅ", cho: "ちょ",
    nya: "にゃ", nyu: "にゅ", nyo: "にょ",
    hya: "ひゃ", hyu: "ひゅ", hyo: "ひょ",
    mya: "みゃ", myu: "みゅ", myo: "みょ",
    rya: "りゃ", ryu: "りゅ", ryo: "りょ",
    gya: "ぎゃ", gyu: "ぎゅ", gyo: "ぎょ",
    ja: "じゃ", ju: "じゅ", jo: "じょ",
    zya: "じゃ", zyu: "じゅ", zyo: "じょ",
    bya: "びゃ", byu: "びゅ", byo: "びょ",
    pya: "ぴゃ", pyu: "ぴゅ", pyo: "ぴょ",
    xtu: "っ", ltu: "っ", xya: "ゃ", lya: "ゃ",
    xyu: "ゅ", lyu: "ゅ", xyo: "ょ", lyo: "ょ",
};

const EXAMPLES = [
    { prompt: "桜の読み方", answer: "さくら" },
    { prompt: "お茶の「ちゃ」", answer: "ちゃ" },
    { prompt: "今日の読み方", answer: "きょう" },
    { prompt: "こんにちは", answer: "こんにちは" },
] as const;

const isKana = (char: string) => /^[ぁ-ゖ]$/.test(char);

export default function KanaTypingPrototypePage() {
    const [exampleIndex, setExampleIndex] = useState(0);
    const [committed, setCommitted] = useState("");
    const [composing, setComposing] = useState("");
    const [invalid, setInvalid] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const answer = EXAMPLES[exampleIndex].answer;
    const letters = Array.from(answer);
    const complete = committed === answer && !composing;

    const candidates = useMemo(
        () =>
            Object.entries(ROMAJI).filter(
                ([roman, kana]) =>
                    roman.startsWith(composing) &&
                    answer.startsWith(kana, committed.length),
            ),
        [answer, committed, composing],
    );

    const reset = (nextExample = exampleIndex) => {
        setExampleIndex(nextExample);
        setCommitted("");
        setComposing("");
        setInvalid(false);
        inputRef.current?.focus();
    };

    const handleCharacter = (raw: string) => {
        if (complete) return;
        const key = raw.toLowerCase();
        if (!/^[a-z]$/.test(key)) return;
        const next = composing + key;
        const nextCandidates = Object.entries(ROMAJI).filter(
            ([roman, kana]) =>
                roman.startsWith(next) &&
                answer.startsWith(kana, committed.length),
        );
        if (!nextCandidates.length) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        const exact = nextCandidates.find(([roman]) => roman === next);
        if (exact) {
            setCommitted((previous) => previous + exact[1]);
            setComposing("");
        } else {
            setComposing(next);
        }
    };

    // Keep the existing box style: w-8 and monospace for English,
    // w-12 and the regular app font for hiragana.
    const remaining = letters.slice(Array.from(committed).length);
    const splitSlots = composing ? Math.max(2, composing.length + 1) : 1;

    return (
        <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-5 py-12">
            <div>
                <h1 className="text-2xl font-bold">日本語タイピングUI プロトタイプ</h1>
                <p className="mt-2 text-sm opacity-70">
                    ゲームの判定・通信には接続しない、表示と入力操作の実験ページです。
                </p>
            </div>
            <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((example, index) => (
                    <button
                        key={example.answer}
                        type="button"
                        onClick={() => reset(index)}
                        aria-pressed={exampleIndex === index}
                        className={`rounded-lg border border-(--color-border) px-3 py-2 text-sm transition-colors ${exampleIndex === index ? "bg-(--color-border)" : ""}`}
                    >
                        {example.answer}
                    </button>
                ))}
            </div>
            <section className="flex flex-col items-center gap-4">
                <div className="w-fit rounded-lg border border-(--color-border) px-2 py-1 text-center text-xl font-bold">
                    {EXAMPLES[exampleIndex].prompt}
                </div>
                <div
                    className={`relative flex w-fit max-w-full flex-wrap justify-start gap-y-3 overflow-clip rounded-lg border border-(--color-border) p-1 ${invalid ? "wrong-answer" : ""}`}
                    onClick={() => inputRef.current?.focus()}
                >
                    {letters.map((char, index) => {
                        const filled = index < Array.from(committed).length;
                        const active = index === Array.from(committed).length && !complete;
                        const slots = active ? splitSlots : 1;
                        const visible = filled ? Array.from(committed)[index] : "";
                        return (
                            <div
                                key={index}
                                className={`relative z-20 flex h-16 cursor-text items-center justify-center rounded-sm p-1 text-3xl font-bold transition-all duration-150 ease-etb ${isKana(char) ? "w-12" : "w-8 font-mono"} ${active ? "bg-(--color-border)" : ""}`}
                            >
                                <div className="flex h-full w-full items-center justify-center overflow-hidden border-b border-(--color-border)">
                                    {active && composing ? (
                                        <div className="flex h-full w-full">
                                            {Array.from({ length: slots }, (_, i) => (
                                                <div
                                                    key={i}
                                                    className={`flex min-w-0 flex-1 items-center justify-center text-base ${i > 0 ? "border-l border-(--color-border)" : ""}`}
                                                >
                                                    {composing[i] ?? ""}
                                                </div>
                                            ))}
                                        </div>
                                    ) : visible}
                                </div>
                            </div>
                        );
                    })}
                    <input
                        ref={inputRef}
                        autoFocus
                        type="text"
                        value=""
                        onChange={(event) => {
                            for (const char of event.target.value) handleCharacter(char);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Backspace") {
                                event.preventDefault();
                                setInvalid(false);
                                if (composing) setComposing(composing.slice(0, -1));
                                else setCommitted(Array.from(committed).slice(0, -1).join(""));
                            }
                        }}
                        className="absolute inset-0 z-10 h-full w-full opacity-[0.01]"
                        aria-label="ローマ字でひらがなを入力"
                        autoCapitalize="off"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                </div>
                <p aria-live="polite" className="text-sm opacity-70">
                    {complete ? "完成！" : invalid ? "この位置では使えないローマ字です" : composing ? `入力中: ${composing}` : "ローマ字で入力してください"}
                </p>
                <button
                    className="rounded-lg border border-(--color-border) px-4 py-2 text-sm"
                    type="button"
                    onClick={() => reset()}
                >
                    やり直す
                </button>
            </section>
            <p className="text-xs opacity-60">
                入力前はひらがな1文字につき w-12。子音入力で2分割、ty / sh などの連続入力で3分割し、確定したら元のマスへ戻ります。
                「ちゃ」のような組み合わせは確定後に2マスへ表示されます。
                この試作では小さい「っ」やIME直接入力などの例外は未対応です。
            </p>
        </main>
    );
}
