import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import type { Item } from "../../type";

const READING_VERSION = 1;
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
    return dictionary;
}

let dictionaryPromise: ReturnType<typeof loadDictionary> | undefined;

export async function generateReadings(answer: string): Promise<string[]> {
    const word = answer.trim().normalize("NFC");
    if (!/\p{Script=Han}/u.test(word) || word.length > 128) return [];
    dictionaryPromise ??= loadDictionary().catch(error => {
        dictionaryPromise = undefined;
        throw error;
    });
    const dictionary = await dictionaryPromise;
    const exact = dictionary.get(word);
    if (exact) return exact;

    // Compose one reading only for compounds fully covered by dictionary words.
    // Avoid guessing arbitrary unknown words from isolated kanji.
    let reading = "";
    for (let start = 0; start < word.length;) {
        let end = word.length;
        while (end > start + 1 && !dictionary.has(word.slice(start, end))) end--;
        const part = word.slice(start, end);
        if (part.length === 1 && !(start > 0 && end === word.length && "者化性法学".includes(part))) return [];
        const best = dictionary.get(part)?.[0];
        if (!best) return [];
        reading += best;
        start = end;
    }
    return reading ? [reading] : [];
}

export async function prepareItemReadings(items: Item[], stored: Item[] = [], generate = generateReadings) {
    const previous = new Map(stored.map(item => [item.id, item]));
    const generated = new Map<string, Promise<string[]>>();
    return Promise.all(items.map(async item => {
        const clean = { ...item };
        delete clean.readings;
        delete clean.reading_version;
        if (typeof item.answer !== "string" || !/\p{Script=Han}/u.test(item.answer)) return clean;

        const old = previous.get(item.id);
        if (old?.answer === item.answer && old.reading_version === READING_VERSION &&
            Array.isArray(old.readings) && old.readings.every(r => typeof r === "string" && kana.test(r))) {
            return { ...clean, readings: [...new Set(old.readings)], reading_version: READING_VERSION };
        }

        let result = generated.get(item.answer);
        if (!result) {
            result = generate(item.answer);
            generated.set(item.answer, result);
        }
        try {
            return { ...clean, readings: await result, reading_version: READING_VERSION };
        } catch {
            // Omit the version so a later save can retry after a transient failure.
            return clean;
        }
    }));
}
