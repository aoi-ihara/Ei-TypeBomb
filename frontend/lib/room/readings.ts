import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import type { Item } from "../../type";

const READING_VERSION = 2;
const kana = /^[ぁ-ゖー]+$/u;
const decompress = promisify(gunzip);

async function loadDictionary() {
    const bytes = await readFile(join(process.cwd(), "lib/room/ipadic/readings.tsv.gz"));
    const lines = (await decompress(bytes)).toString().split("\n");
    const dictionary = new Map<string, string[]>();
    for (const line of lines) {
        const [word, ...readings] = line.split("\t");
        dictionary.set(word, readings);
    }
    // Technical stems missing from IPADIC; usable alone and within longer words.
    for (const [word, reading] of Object.entries({
        塩析: "えんせき", 凝析: "ぎょうせき", 泳動: "えいどう", 懸濁: "けんだく", 乳濁: "にゅうだく",
    })) {
        if (!dictionary.has(word)) dictionary.set(word, [reading]);
    }
    return dictionary;
}

let dictionaryPromise: ReturnType<typeof loadDictionary> | undefined;

const target = /[\p{Script=Han}\p{Script=Katakana}]/u;
const misses = new Map<string, number>();

function hiragana(text: string) {
    return text.replace(/[ァ-ヶ]/gu, c => String.fromCharCode(c.charCodeAt(0) - 96));
}

// Keep the longest segment with a fully readable suffix, backtracking over
// dead ends. Emit one candidate for a split word rather than a cross product.
function compoundReading(word: string, dictionary: Map<string, string[]>) {
    const suffix = new Map<number, string>([[word.length, ""]]);
    for (let start = word.length - 1; start >= 0; start--) {
        for (let end = word.length; end > start; end--) {
            const tail = suffix.get(end);
            if (tail === undefined) continue;
            const part = word.slice(start, end);
            let reading = hiragana(part);
            if (!kana.test(reading)) {
                if (part.length === 1 && !(start && end === word.length && "者化性法学液".includes(part))) continue;
                reading = dictionary.get(part)?.[0] ?? "";
            }
            if (reading) {
                suffix.set(start, reading + tail);
                break;
            }
        }
    }
    return suffix.get(0);
}

export async function generateReadings(answer: string): Promise<string[]> {
    const word = answer.trim().normalize("NFKC");
    if (!target.test(word) || word.length > 128) return [];
    if (!/\p{Script=Han}/u.test(word)) {
        const reading = hiragana(word);
        return kana.test(reading) ? [reading] : [];
    }
    if ((misses.get(word) ?? 0) > Date.now()) return [];
    dictionaryPromise ??= loadDictionary().catch(error => {
        dictionaryPromise = undefined;
        throw error;
    });
    const dictionary = await dictionaryPromise;
    const exact = dictionary.get(word);
    if (exact) return exact;
    const reading = compoundReading(word, dictionary);
    if (reading) return [reading];
    // Cache deterministic misses only, for at most ten minutes per process.
    if (misses.size >= 1024) misses.delete(misses.keys().next().value!);
    misses.set(word, Date.now() + 600_000);
    return [];
}

export async function prepareItemReadings(items: Item[], stored: Item[] = [], generate = generateReadings,
    onGenerationError?: () => void) {
    const previous = new Map(stored.map(item => [item.id, item]));
    const generated = new Map<string, string[] | null>();
    const prepared: Item[] = [];
    for (const item of items) {
        const clean = { ...item };
        delete clean.readings;
        delete clean.reading_version;
        prepared.push(clean);
        if (typeof item.answer !== "string" || !target.test(item.answer)) continue;

        const old = previous.get(item.id);
        if (old?.answer === item.answer && old.reading_version === READING_VERSION &&
            Array.isArray(old.readings) && old.readings.length > 0 &&
            old.readings.every(r => typeof r === "string" && kana.test(r))) {
            clean.readings = old.readings;
            clean.reading_version = READING_VERSION;
            continue;
        }

        let result = generated.get(item.answer);
        if (result === undefined) {
            try {
                result = await generate(item.answer);
            } catch {
                result = null;
                onGenerationError?.();
            }
            generated.set(item.answer, result);
        }
        if (result !== null) {
            clean.readings = result;
            clean.reading_version = READING_VERSION;
        }
    }
    return prepared;
}
