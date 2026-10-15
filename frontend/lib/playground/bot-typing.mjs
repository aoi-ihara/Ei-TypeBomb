import {
    ROMAJI,
    advanceKanaInput,
    encodeKanaProgress,
    hasHiragana,
} from "../romaji-input.mjs";

// Longest kana match first: "ちゃ" must be typed as a single roman syllable
// (tya), rather than "ち" + "ゃ" (ti + xya). The ROMAJI insertion
// order breaks ties to choose the same default spelling as the player UI.
const romanSyllables = Object.entries(ROMAJI)
    .sort((a, b) => b[1].length - a[1].length);

/**
 * Generate individual simulated keypresses for a correct answer.
 * The human player's existing converter is the source of truth.
 *
 * @param {string} answer
 * @returns {string[]}
 */
export function getBotRomanKeys(answer) {
    const keys = [];
    let position = 0;
    while (position < answer.length) {
        const remaining = answer.slice(position);
        const match = romanSyllables.find(([, kana]) =>
            remaining.startsWith(kana),
        );
        if (match) {
            keys.push(...match[0]);
            position += match[1].length;
        } else {
            // English, digits, punctuation and spaces are literal keys.
            keys.push(answer[position]);
            position += 1;
        }
    }
    return keys;
}

/**
 * InputView's read-only view expects the already-confirmed kana followed by
 * the unfinished roman prefix (e.g. "きょu", "ち"? no; "ty" -> ちゃ).
 * Generate exactly that representation on each simulated keypress.
 *
 * @param {string} answer
 * @returns {string[]} successive remote-input frames
 */
export function getBotTypingFrames(answer) {
    if (!hasHiragana(answer)) {
        return Array.from(answer, (_, index) =>
            answer.slice(0, index + 1),
        );
    }

    let progress = { committed: "", composing: "" };
    const frames = [];
    const keys = getBotRomanKeys(answer);
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        // After nn completes ん, the second n is already the first
        // keystroke of a following n-row kana. Avoid typing it twice.
        if (
            key === "n" &&
            progress.composing === "n" &&
            progress.committed.endsWith("ん") &&
            keys[index + 1] !== "n"
        ) {
            continue;
        }

        const next = advanceKanaInput(answer, progress, key);
        if (!next.accepted) {
            // An unsupported imported answer must never trap the bot turn.
            // Fall back to showing the exact completed answer so gameplay
            // proceeds, instead of stalling on an impossible roman sequence.
            return Array.from(answer, (_, i) => answer.slice(0, i + 1));
        }
        progress = { committed: next.committed, composing: next.composing };
        frames.push(encodeKanaProgress(progress));
    }
    if (progress.committed !== answer || progress.composing) {
        return Array.from(answer, (_, i) => answer.slice(0, i + 1));
    }
    return frames;
}
