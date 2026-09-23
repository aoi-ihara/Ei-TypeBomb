type ImportedWord = { jp: string; en: string };

function parseCsv(source: string): ImportedWord[] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    let closedQuote = false;

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

    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        if (quoted) {
            if (char === '"') {
                if (source[index + 1] === '"') {
                    field += '"';
                    index++;
                } else {
                    quoted = false;
                    closedQuote = true;
                }
            } else {
                field += char;
            }
        } else if (char === ",") {
            finishField();
        } else if (char === "\n" || char === "\r") {
            finishRow();
            if (char === "\r" && source[index + 1] === "\n") index++;
        } else if (closedQuote) {
            if (!/\s/.test(char)) throw new Error("Invalid CSV quote");
        } else if (char === '"') {
            if (field.trim()) throw new Error("Invalid CSV quote");
            field = "";
            quoted = true;
        } else {
            field += char;
        }
    }
    if (quoted) throw new Error("Unclosed CSV quote");
    finishRow();
    if (!rows.length) throw new Error("Empty CSV");

    const countNonAlphanumeric = (value: string) =>
        Array.from(value).filter((char) => !/[a-zA-Z0-9]/.test(char)).length;

    let leftCount = 0;
    let rightCount = 0;
    for (const columns of rows) {
        if (columns.length !== 2 || columns.some((value) => !value)) {
            throw new Error("CSV requires two non-empty columns per row");
        }
        leftCount += countNonAlphanumeric(columns[0]);
        rightCount += countNonAlphanumeric(columns[1]);
    }

    const japaneseIsLeft = leftCount >= rightCount;
    return rows.map(([first, second]) =>
        japaneseIsLeft
            ? { jp: first, en: second }
            : { jp: second, en: first },
    );
}

export function parseImportedWords(source: string): ImportedWord[] {
    const normalized = source.replace(/^\uFEFF/, "").trim();
    try {
        const parsed: unknown = JSON.parse(normalized);
        if (
            !Array.isArray(parsed) ||
            !parsed.every(
                (word) =>
                    word !== null &&
                    typeof word === "object" &&
                    typeof word.jp === "string" &&
                    typeof word.en === "string",
            )
        ) {
            throw new Error("Invalid word JSON");
        }
        return parsed.map(({ jp, en }) => ({ jp, en }));
    } catch {
        return parseCsv(normalized);
    }
}
