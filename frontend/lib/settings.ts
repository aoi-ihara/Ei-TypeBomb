export type OfflineVoiceReading = "none" | "question" | "answer";

export const parseOfflineVoiceReading = (
    value: string | undefined,
): OfflineVoiceReading => {
    if (value === "question" || value === "answer" || value === "none") {
        return value;
    }
    return "none";
};
