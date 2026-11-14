export const MAX_PROMPT_LENGTH = 1000;
export const MAX_ANSWER_LENGTH = 100;

// Count Unicode code points, matching JSON Schema maxLength.
export function promptLengthError(prompt) {
    return Array.from(prompt).length > MAX_PROMPT_LENGTH
        ? `問題文は${MAX_PROMPT_LENGTH}文字以内で入力してください。`
        : null;
}

export function answerLengthError(answer) {
    return Array.from(answer).length > MAX_ANSWER_LENGTH
        ? `回答は${MAX_ANSWER_LENGTH}文字以内で入力してください。`
        : null;
}
