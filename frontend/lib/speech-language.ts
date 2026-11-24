import { detectAll } from "tinyld/light";

type Side = "prompt" | "answer";
type RoomText = Readonly<Record<Side, string>>;
type Candidate = { lang: string; accuracy: number };
type Detector = (text: string) => Candidate[];

const SAMPLE_LIMIT = 64;
const CACHE_LIMIT = 1024;
const letters = new RegExp("\\p{L}", "gu");
// Homogeneous scripts must match the locale; mixed text goes through the model.
const scriptCodes: Record<string, string> = {
    Latin: "Latn", Cyrillic: "Cyrl", Greek: "Grek", Arabic: "Arab",
    Hebrew: "Hebr", Devanagari: "Deva", Bengali: "Beng",
    Gurmukhi: "Guru", Gujarati: "Gujr", Oriya: "Orya",
    Tamil: "Taml", Telugu: "Telu", Kannada: "Knda", Malayalam: "Mlym",
    Sinhala: "Sinh", Thai: "Thai", Lao: "Laoo", Myanmar: "Mymr",
    Khmer: "Khmr", Georgian: "Geor", Armenian: "Armn",
    Ethiopic: "Ethi", Tibetan: "Tibt", Mongolian: "Mong",
};
const scriptMatchers = Object.entries(scriptCodes).map(([script, code]) => ({
    code,
    pattern: new RegExp("^\\p{Script_Extensions=" + script + "}+$", "u"),
}));
const han = new RegExp("^\\p{Script=Han}+$", "u");

function scriptLanguage(text: string): string | undefined {
    text = text.normalize("NFKC");
    if (/[\u3041-\u3096\u30a1-\u30fa\u31f0-\u31ff]/u.test(text)) return "ja";
    if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/u.test(text)) return "ko";
    return undefined;
}

function languageTag(lang: string): string {
    try {
        const locale = new Intl.Locale(lang);
        if (locale.region) return locale.baseName;
        const region = locale.maximize().region;
        return region ? `${locale.baseName}-${region}` : locale.baseName;
    } catch {
        return lang;
    }
}

function compatible(text: string, lang: string): boolean {
    const chars = (text.normalize("NFKC").match(letters) ?? []).join("");
    if (!chars) return true;
    if (han.test(chars)) return /^(ja|zh)(-|$)/i.test(lang);
    const script = scriptMatchers.find(({ pattern }) => pattern.test(chars));
    if (!script) return true;
    try {
        return new Intl.Locale(lang).maximize().script === script.code;
    } catch {
        return false;
    }
}

function confident(candidates: Candidate[], minScore = 0.45): boolean {
    const first = candidates[0];
    return !!first && first.accuracy >= minScore &&
        first.accuracy - (candidates[1]?.accuracy ?? 0) >= 0.15;
}

// The room provides a prior, not an explicit language setting. Keep the
// prompt and answer distributions independent, and compute them lazily
// only when speech is actually requested.
export function createSpeechLanguageResolver(
    items: readonly RoomText[],
    detector: Detector = detectAll,
) {
    const candidatesByText = new Map<string, Candidate[]>();
    const contexts = new Map<Side, string | undefined>();
    const resolved = new Map<string, string>();

    function candidates(text: string): Candidate[] {
        const key = text.normalize("NFKC").trim().slice(0, 1000);
        const cached = candidatesByText.get(key);
        if (cached) return cached;
        let result: Candidate[] = [];
        try {
            result = detector(key).filter(({ lang, accuracy }) =>
                !!lang && Number.isFinite(accuracy) && accuracy > 0 &&
                compatible(key, lang),
            ).sort((a, b) => b.accuracy - a.accuracy);
        } catch {
            // Unsupported or non-linguistic input must not interrupt play.
        }
        if (candidatesByText.size >= CACHE_LIMIT) candidatesByText.clear();
        candidatesByText.set(key, result);
        return result;
    }

    function context(side: Side): string | undefined {
        if (contexts.has(side)) return contexts.get(side);
        const count = Math.min(SAMPLE_LIMIT, items.length);
        const samples = Array.from({ length: count }, (_, index) =>
            items[Math.floor(index * items.length / count)][side].trim().slice(0, 128),
        ).filter(Boolean);
        const votes = new Map<string, number>();
        for (const text of new Set(samples)) {
            const script = scriptLanguage(text);
            const options = script ? [] : candidates(text);
            const chars = (text.normalize("NFKC").match(letters) ?? []).join("");
            const lang = script ?? (
                chars.length >= 5 && !han.test(chars) && confident(options)
                    ? options[0].lang : undefined
            );
            if (lang) votes.set(lang, (votes.get(lang) ?? 0) + 1);
        }
        const ranked = [...votes].sort((a, b) => b[1] - a[1]);
        const total = ranked.reduce((sum, [, n]) => sum + n, 0);
        let inferred: string | undefined;
        if (ranked[0] && ranked[0][1] >= 2 && ranked[0][1] / total >= 0.7) {
            inferred = ranked[0][0];
        } else if (ranked.length <= 1 && samples.length >= 3) {
            // Pool short vocabulary entries to obtain enough textual evidence.
            const joined = samples.join(" ").slice(0, 1000);
            const options = candidates(joined);
            if (confident(options) && (!ranked[0] || ranked[0][0] === options[0].lang)) {
                inferred = options[0].lang;
            }
        }
        contexts.set(side, inferred);
        return inferred;
    }

    return (text: string, side: Side, browserLanguage?: string): string => {
        const key = JSON.stringify([side, text, browserLanguage]);
        const cached = resolved.get(key);
        if (cached) return cached;
        const chars = (text.normalize("NFKC").match(letters) ?? []).join("");
        const script = scriptLanguage(text);
        let lang = script;
        if (!lang) {
            const options = candidates(text);
            const first = options[0];
            const prior = context(side);
            const priorCompatible = prior && compatible(text, prior);
            const browserCompatible = browserLanguage && compatible(text, browserLanguage);
            if (chars && han.test(chars)) {
                // Kanji/Hanzi alone cannot reliably distinguish Japanese and Chinese.
                lang = priorCompatible ? prior : browserCompatible ? browserLanguage : first?.lang;
            } else if (chars.length >= 5 && confident(options)) {
                lang = first.lang;
            } else if (priorCompatible) {
                lang = prior;
            } else if (first && chars.length >= 3 && confident(options)) {
                lang = first.lang;
            } else if (browserCompatible) {
                lang = browserLanguage;
            } else if (first && chars.length >= 3) {
                lang = first.lang;
            }
        }
        // Preserve a useful fallback for ambiguous symbols or unavailable models.
        const tag = languageTag(lang ?? (side === "prompt" ? "ja" : "en"));
        if (resolved.size >= CACHE_LIMIT) resolved.clear();
        resolved.set(key, tag);
        return tag;
    };
}
