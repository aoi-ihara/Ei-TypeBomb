import { parseImportedPairs } from "./importWords.mjs";

export type ImportedWord = { jp: string; en: string };

export function parseImportedWords(source: string): ImportedWord[] {
    return parseImportedPairs(source);
}

export {
    isAllowedTypingAnswer,
    filterTypingAnswer,
    countTypingCharacters,
    orientImportPair,
    exportAnswerPairs,
} from "./importWords.mjs";
