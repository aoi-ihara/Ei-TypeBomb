// The importer treats the two columns as *values*. It does not assume
// that Japanese is always the question or that English is the answer.
const ANSWER_CHAR = /^[a-zA-Z0-9\- ぁ-ゖ,.!?、。！？]$/u;
const COUNTED_CHAR = /^[a-zA-Z0-9ぁ-ゖ]$/u;

export function isAllowedTypingAnswer(value) {
    return typeof value === "string" &&
        value.length > 0 &&
        Array.from(value).every((char) => ANSWER_CHAR.test(char));
}

export function filterTypingAnswer(value) {
    return Array.from(value).filter((char) => ANSWER_CHAR.test(char)).join("");
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

function validatePair(left, right, rowNumber) {
    if (typeof left !== "string" || typeof right !== "string" ||
        !left.trim() || !right.trim()) {
        throw new Error(`行${rowNumber}: 問題と回答はどちらも文字列で入力してください。`);
    }
    const item = orientImportPair(left.trim(), right.trim());
    if (!isAllowedTypingAnswer(item.en)) {
        throw new Error(`行${rowNumber}: 回答には英数字・ひらがな・スペース・ハイフン・指定の句読点のみ使用できます。`);
    }
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
    return rows.map((columns, i) => {
        if (columns.length !== 2) throw new Error(`行${i + 1}: CSVは2列にしてください。`);
        return validatePair(columns[0], columns[1], i + 1);
    });
}

function parseJson(parsed) {
    // Preferred format: [{"りんご":"apple"},{"さくら":"sakura"}]
    // Explicit question/answer objects and legacy jp/en objects stay readable.
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("JSONは問題と回答のオブジェクトの配列にしてください。");
    }
    return parsed.map((entry, i) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            throw new Error(`行${i + 1}: JSONの各要素はオブジェクトにしてください。`);
        }
        if (Object.hasOwn(entry, "question") && Object.hasOwn(entry, "answer")) {
            return validatePair(entry.question, entry.answer, i + 1);
        }
        if (Object.hasOwn(entry, "jp") && Object.hasOwn(entry, "en")) {
            return validatePair(entry.jp, entry.en, i + 1);
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
    return JSON.stringify(items.map(item => ({ [item.prompt]: item.answer })), null, 4);
}
