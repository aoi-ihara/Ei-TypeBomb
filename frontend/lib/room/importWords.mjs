import { ROMAJI } from "../romaji-input.mjs";

// The importer treats the two columns as *values*. It does not assume
// that Japanese is always the question or that English is the answer.
const ANSWER_CHAR = /^[a-zA-Z0-9 ,.?!\-、。！？]$/u;
// Keep authoring validation aligned with the game romanization dictionary.
const SUPPORTED_KANA = new Set(Object.values(ROMAJI).flatMap(value => Array.from(value)));
const allowedAnswerChar = char => ANSWER_CHAR.test(char) || SUPPORTED_KANA.has(char);
const COUNTED_CHAR = /^[a-zA-Z0-9ぁ-ゖ]$/u;

export function isAllowedTypingAnswer(value) {
    return typeof value === "string" &&
        value.length > 0 &&
        Array.from(value).every(allowedAnswerChar);
}

export function filterTypingAnswer(value) {
    return Array.from(value).filter(allowedAnswerChar).join("");
}

export function countTypingCharacters(value) {
    return Array.from(value).filter((char) => COUNTED_CHAR.test(char)).length;
}

export function orientImportPair(left, right) {
    const leftCount = countTypingCharacters(left);
    const rightCount = countTypingCharacters(right);
    const leftIsDominant = leftCount > rightCount && leftCount >= 2 * rightCount;
    const rightIsDominant = rightCount > leftCount && rightCount >= 2 * leftCount;
    const answer = leftIsDominant ? left : right;
    const question = leftIsDominant ? right : left;
    // Right remains the answer for tied or similar lengths.
    return { jp: question, en: answer };
}

function validatePair(left, right, rowNumber, rolesExplicit = false) {
    if (typeof left !== "string" || typeof right !== "string" ||
        !left.trim() || !right.trim()) {
        throw new Error(`行${rowNumber}: 問題と回答はどちらも文字列で入力してください。`);
    }
    const item = rolesExplicit
        ? { jp: left.trim(), en: right.trim() }
        : orientImportPair(left.trim(), right.trim());
    // Import is intentionally permissive: an answer may be unplayable until
    // its author edits it. The room editor shows a per-item validation error.
    // Reject only malformed pairs, never an answer's character set here.
    return item;
}

function parseCsv(source) {
    const rows = [];
    let row = [], field = "", quoted = false, closedQuote = false;
    const finishField = () => {
        row.push(field.trim());
        field = "";
        closedQuote = false;
    };
    const finishRow = () => {
        finishField();
        if (row.length !== 1 || row[0] !== "") rows.push(row);
        row = [];
    };

    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (quoted) {
            if (char === '"') {
                if (source[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    quoted = false;
                    closedQuote = true;
                }
            } else field += char;
        } else if (char === ",") finishField();
        else if (char === "\n" || char === "\r") {
            finishRow();
            if (char === "\r" && source[i + 1] === "\n") i++;
        } else if (closedQuote) {
            if (!/\s/.test(char)) throw new Error("CSVの引用符の後に不正な文字があります。");
        } else if (char === '"') {
            if (field.trim()) throw new Error("CSVの引用符が不正です。");
            field = "";
            quoted = true;
        } else field += char;
    }
    if (quoted) throw new Error("CSVの引用符が閉じられていません。");
    finishRow();
    if (!rows.length) throw new Error("CSVに問題がありません。");
    // Validate the entire CSV before deciding the column roles.
    // Each CSV uses one consistent orientation, based on the aggregated
    // ASCII alphanumeric + hiragana counts of both complete columns.
    const pairs = rows.map((columns, i) => {
        if (columns.length !== 2) throw new Error(`行${i + 1}: CSVは2列にしてください。`);
        const [left, right] = columns;
        if (!left.trim() || !right.trim()) {
            throw new Error(`行${i + 1}: 問題と回答はどちらも文字列で入力してください。`);
        }
        return [left.trim(), right.trim()];
    });
    const leftTotal = pairs.reduce((sum, [left]) => sum + countTypingCharacters(left), 0);
    const rightTotal = pairs.reduce((sum, [, right]) => sum + countTypingCharacters(right), 0);
    const answerIsLeft = leftTotal > rightTotal && leftTotal >= 2 * rightTotal;

    return pairs.map(([left, right], i) =>
        validatePair(
            answerIsLeft ? right : left,
            answerIsLeft ? left : right,
            i + 1,
            true,
        ),
    );
}

function parseJson(parsed) {
    // Preferred compact format: { "ねこ": "cat", "桜": "さくら" }.
    // Here keys are explicitly questions and values are explicitly answers;
    // never reapply the CSV length heuristic or exports could swap roles.
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed);
        if (!entries.length) throw new Error("JSONには問題と回答を1件以上入力してください。");
        return entries.map(([question, answer], i) =>
            validatePair(question, answer, i + 1, true),
        );
    }

    // Read historical array formats for backwards compatibility.
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("JSONは問題文と回答のオブジェクトにしてください。");
    }
    return parsed.map((entry, i) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`行${i + 1}: JSONの各要素はオブジェクトにしてください。`);
        }
        if (Object.hasOwn(entry, "question") && Object.hasOwn(entry, "answer")) {
            return validatePair(entry.question, entry.answer, i + 1, true);
        }
        if (Object.hasOwn(entry, "jp") && Object.hasOwn(entry, "en")) {
            return validatePair(entry.jp, entry.en, i + 1, true);
        }
        const entries = Object.entries(entry);
        if (entries.length !== 1) {
            throw new Error(`行${i + 1}: JSONの各要素は問題と回答の1組にしてください。`);
        }
        return validatePair(entries[0][0], entries[0][1], i + 1);
    });
}

export function parseImportedPairs(source) {
    const normalized = source.replace(/^\uFEFF/, "").trim();
    if (!normalized) throw new Error("インポートするデータがありません。");
    // JSON syntax errors must not be treated as CSV.
    if (normalized.startsWith("[") || normalized.startsWith("{")) {
        let parsed;
        try {
            parsed = JSON.parse(normalized);
        } catch {
            throw new Error("JSONの構文が正しくありません。");
        }
        return parseJson(parsed);
    }
    return parseCsv(normalized);
}

export function exportAnswerPairs(items) {
    const pairs = {};
    for (const item of items) {
        // A JSON object cannot represent two distinct answers for one key.
        // Fail rather than silently discard data.
        if (Object.hasOwn(pairs, item.prompt)) {
            throw new Error(`問題文「${item.prompt}」が重複しています。JSONでは同じ問題文を2件書き出せません。`);
        }
        Object.defineProperty(pairs, item.prompt, {
            value: item.answer, enumerable: true, configurable: true, writable: true,
        });
    }
    return JSON.stringify(pairs, null, 4);
}
