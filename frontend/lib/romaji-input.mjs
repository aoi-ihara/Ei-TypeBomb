// Shared, dependency-free roman-key conversion for play and spectator views.
// The persisted answer is always kana; composing letters are transient.
export const ROMAJI = Object.freeze({
    a: "あ", i: "い", u: "う", e: "え", o: "お",
    ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ",
    sa: "さ", si: "し", shi: "し", su: "す", se: "せ", so: "そ",
    ta: "た", ti: "ち", chi: "ち", tu: "つ", tsu: "つ", te: "て", to: "と",
    na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の",
    ha: "は", hi: "ひ", hu: "ふ", fu: "ふ", he: "へ", ho: "ほ",
    ma: "ま", mi: "み", mu: "む", me: "め", mo: "も",
    ya: "や", yu: "ゆ", yo: "よ",
    ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ",
    wa: "わ", wi: "うぃ", we: "うぇ", wo: "を", nn: "ん",
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
    cya: "ちゃ", cyu: "ちゅ", cyo: "ちょ",
    nya: "にゃ", nyu: "にゅ", nyo: "にょ",
    hya: "ひゃ", hyu: "ひゅ", hyo: "ひょ",
    mya: "みゃ", myu: "みゅ", myo: "みょ",
    rya: "りゃ", ryu: "りゅ", ryo: "りょ",
    gya: "ぎゃ", gyu: "ぎゅ", gyo: "ぎょ",
    ja: "じゃ", ju: "じゅ", jo: "じょ",
    zya: "じゃ", zyu: "じゅ", zyo: "じょ",
    jya: "じゃ", jyu: "じゅ", jyo: "じょ",
    bya: "びゃ", byu: "びゅ", byo: "びょ",
    pya: "ぴゃ", pyu: "ぴゅ", pyo: "ぴょ",
    xtu: "っ", ltu: "っ", xtsu: "っ", ltsu: "っ",
    xya: "ゃ", lya: "ゃ", xyu: "ゅ", lyu: "ゅ", xyo: "ょ", lyo: "ょ",
    xa: "ぁ", la: "ぁ", xi: "ぃ", li: "ぃ", xu: "ぅ", lu: "ぅ",
    xe: "ぇ", le: "ぇ", xo: "ぉ", lo: "ぉ",
});

const entries = Object.entries(ROMAJI);

/** @param {string} char */
export const isHiragana = (char) => /^[ぁ-ゖ]$/u.test(char);
/** @param {string} answer */
export const hasHiragana = (answer) => Array.from(answer).some(isHiragana);

/** @typedef {{committed: string, composing: string}} KanaProgress */

/**
 * @param {string} answer
 * @param {KanaProgress} progress
 * @param {string} rawKey
 * @returns {{accepted: boolean, committed: string, composing: string}}
 */
export function advanceKanaInput(answer, progress, rawKey) {
    const { committed, composing } = progress;
    const rejected = { accepted: false, committed, composing };
    if (committed === answer || rawKey.length !== 1) return rejected;
    const key = rawKey.toLowerCase();
    const rest = answer.slice(committed.length);
    const target = Array.from(rest)[0];

    // ASCII, spaces and hyphens retain their literal answer representation.
    if (!isHiragana(target)) {
        if (!composing && key === target?.toLowerCase()) {
            return { accepted: true, committed: committed + target, composing: "" };
        }
        // The pending n is complete before a non-kana separator.
        if (composing === "n" && target === undefined) return rejected;
        return rejected;
    }

    // n before a consonant (or separator) belongs to ん; reprocess the key
    // as the start of the following kana. n + vowel/y stays ambiguous.
    if (target === "ん" && composing === "n") {
        if (key === "'") {
            return { accepted: true, committed: committed + "ん", composing: "" };
        }
        if (key !== "n" && !/[aiueoy]/.test(key)) {
            const next = advanceKanaInput(answer, { committed: committed + "ん", composing: "" }, rawKey);
            if (next.accepted) return next;
        }
    }

    // Accept consonant doubling for っ, as well as x/ltu spelling.
    const following = rest.slice(1);
    const nextKanaStartsWith = (letter) =>
        entries.some(([roman, kana]) => roman.startsWith(letter) && following.startsWith(kana));
    if (target === "っ" && /^[bcdfghjklmpqrstvwxyz]$/.test(key) && key !== "n") {
        if (!composing && nextKanaStartsWith(key)) {
            return { accepted: true, committed, composing: key };
        }
        if (composing === key && nextKanaStartsWith(key)) {
            return { accepted: true, committed: committed + "っ", composing: key };
        }
    }

    // After nn completes ん, the second n is also carried into な/に/ぬ/ね/の.
    // An explicitly typed third n (dannna) is also valid: consume it without
    // counting an error or resetting the already correct input.
    if (
        composing === "n" && key === "n" && committed.endsWith("ん") &&
        entries.some(([roman, kana]) =>
            roman.startsWith("n") && kana !== "ん" && rest.startsWith(kana),
        )
    ) {
        return { accepted: true, committed, composing: "n" };
    }

    const tentative = composing + key;
    const candidates = entries.filter(
        ([roman, kana]) => roman.startsWith(tentative) && rest.startsWith(kana),
    );
    if (!candidates.length) return rejected;
    const exact = candidates.find(([roman]) => roman === tentative);
    if (!exact) return { accepted: true, committed, composing: tentative };

    const nextCommitted = committed + exact[1];
    // konnichiha: the second n both finishes ん and starts に.
    const carryN = tentative === "nn" &&
        entries.some(([roman, kana]) =>
            roman.startsWith("n") && kana !== "ん" &&
            answer.slice(nextCommitted.length).startsWith(kana),
        );
    return { accepted: true, committed: nextCommitted, composing: carryN ? "n" : "" };
}

/**
 * Network typing sync remains a single plain string (no protocol migration).
 * @param {KanaProgress} progress
 */
export const encodeKanaProgress = ({ committed, composing }) => committed + composing;

/**
 * Reads the correct committed prefix followed by unfinished roman keys from
 * the existing typing:input string. No correct answer is encoded on the wire.
 * @param {string} answer
 * @param {string} wire
 * @returns {KanaProgress}
 */
export function decodeKanaProgress(answer, wire) {
    let i = 0;
    while (i < answer.length && i < wire.length && answer[i] === wire[i]) i += 1;
    return { committed: wire.slice(0, i), composing: wire.slice(i) };
}

/** @param {string} composing */
export const romanSlotCount = (composing) =>
    composing ? Math.max(2, Math.min(4, composing.length + 1)) : 1;

/**
 * Returns the visible roman key cells and any kana covered by a combination.
 * A fully hinted kana group can reveal its roman spelling (e.g. tya)
 * before the user has typed the second consonant.
 *
 * @param {string} answer
 * @param {number} startIndex - UTF-16 index of the next uncommitted kana.
 * @param {string} composing
 * @param {number} hintLength
 */
export function kanaCompositionLayout(answer, startIndex, composing, hintLength = 0) {
    if (!composing || !isHiragana(answer.slice(startIndex)[0] ?? "")) {
        return { slots: 1, hintRoman: "", occupies: 1 };
    }
    const remaining = answer.slice(startIndex);
    const matching = entries.filter(
        ([roman, kana]) => roman.startsWith(composing) && remaining.startsWith(kana),
    );
    // Existing ROMAJI ordering chooses the default spelling, while the
    // user's typed prefix always selects their variant (tya vs cha).
    const choice = matching[0];
    const entireGroupHinted = !!choice &&
        hintLength >= startIndex + choice[1].length;
    const hintRoman = entireGroupHinted ? choice[0] : "";

    return {
        slots: Math.max(romanSlotCount(composing), hintRoman.length),
        hintRoman,
        // The second key disambiguates a combined syllable. Hide the following
        // kana box only then, not after an initial single consonant.
        occupies: composing.length >= 2 && choice ? choice[1].length : 1,
    };
}
