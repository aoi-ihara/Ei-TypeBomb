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
    const matching = entries
        .filter(([roman, kana]) =>
            roman.startsWith(composing) && remaining.startsWith(kana),
        )
        // A hinted ちゃ must choose the combined reading "tya" over "ti"
        // (which matches only the first character ち).
        .sort((a, b) => b[1].length - a[1].length);
    // Original ROMAJI order breaks ties; the typed prefix picks tya / cha.
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

/**
 * Editable typing uses the typed romanization, not the expected answer,
 * to convert kana. Incorrect but valid kana remain visible until every answer
 * position has been attempted (and can be corrected with cursor navigation).
 * Strict advanceKanaInput is retained for the standalone prototype.
 *
 * @param {string} answer
 * @param {number} cursor
 * @param {string} composing
 * @param {string} rawKey
 * @returns {{accepted: boolean, emitted: string, composing: string}}
 */
export function advanceEditableKanaAt(answer, cursor, composing, rawKey) {
    const reject = { accepted: false, emitted: "", composing };
    if (rawKey.length !== 1 || cursor < 0 || cursor >= answer.length) return reject;
    const key = rawKey.toLowerCase();
    const char = answer[cursor];

    if (!isHiragana(char)) {
        return { accepted: true, emitted: rawKey, composing: "" };
    }
    if (!/^[a-z']$/.test(key)) return reject;

    const nextKana = answer.slice(cursor + 1);
    // The carried n from ん + な/に/ぬ/ね/の can be reused as-is (danna)
    // or an extra n can be explicitly entered (dannna).
    if (composing === "n" && key === "n" && answer[cursor - 1] === "ん" &&
        entries.some(([roman, kana]) =>
            roman.startsWith("n") && kana !== "ん" && nextKana !== "" &&
            answer.slice(cursor).startsWith(kana))) {
        return { accepted: true, emitted: "", composing: "n" };
    }

    if (composing === "n" && key === "'") {
        return { accepted: true, emitted: "ん", composing: "" };
    }

    // Consume n before a consonant as ん and retry that consonant at
    // the next kana, mirroring native romanization conventions.
    if (composing === "n" && key !== "n" && !/[aiueoy]/.test(key)) {
        const next = advanceEditableKanaAt(answer, cursor + 1, "", rawKey);
        if (next.accepted) {
            return { accepted: true, emitted: "ん" + next.emitted, composing: next.composing };
        }
    }

    // Double consonants produce っ and carry the second consonant into
    // the next syllable (gakkou); don't trigger a premature failure.
    if (composing === key && /^[bcdfghjklmpqrstvwxyz]$/.test(key) && key !== "n") {
        return { accepted: true, emitted: "っ", composing: key };
    }

    const roman = composing + key;
    const exact = ROMAJI[roman];
    if (exact) {
        const carryN = roman === "nn" &&
            entries.some(([candidate, kana]) =>
                candidate.startsWith("n") && kana !== "ん" &&
                nextKana.startsWith(kana));
        return { accepted: true, emitted: exact, composing: carryN ? "n" : "" };
    }

    // Keep even an invalid roman prefix (such as "sq") in the active boxes.
    // The user can Backspace to repair it; it is not an early wrong answer.
    return { accepted: true, emitted: "", composing: roman };
}

/**
 * Apply a roman key to a selected answer cell. Does not compare the emitted
 * kana to the answer until the entire item has been entered.
 *
 * @param {string} answer
 * @param {string[]} cells
 * @param {number} cursor
 * @param {string} composing
 * @param {string} key
 */
export function editKanaCell(answer, cells, cursor, composing, key) {
    const result = advanceEditableKanaAt(answer, cursor, composing, key);
    const next = [...cells];
    if (!result.accepted) {
        return {
            accepted: false, cells: next, cursor, composing, advance: 0,
            complete: false, correct: false,
        };
    }
    const emitted = Array.from(result.emitted);
    // A multi-kana reading (e.g. ちゃ) spans adjacent answer cells.
    // If it overflows the end, keep it as one *wrong* cell instead of
    // accidentally trimming it to the correct answer.
    const advance = Math.min(emitted.length, answer.length - cursor);
    if (advance && emitted.length > advance) {
        next[cursor] = result.emitted;
    } else {
        emitted.forEach((letter, index) => {
            next[cursor + index] = letter;
        });
    }
    const complete = advance > 0 && next.every((char) => char !== "");
    return {
        accepted: true,
        cells: next,
        cursor: advance ? Math.min(answer.length - 1, cursor + advance) : cursor,
        composing: result.composing,
        advance,
        complete,
        correct: complete && next.join("") === answer,
    };
}

/** Cursor movement is always independent of correct-answer progress. */
export const nextKanaCursor = (cursor, direction, length) =>
    Math.max(0, Math.min(length - 1, cursor + direction));
