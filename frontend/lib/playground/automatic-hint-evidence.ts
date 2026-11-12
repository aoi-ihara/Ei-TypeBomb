type HintExposure = {
    initial: boolean;
    assisted: boolean;
};

export const createAutomaticHintEvidence = (
    answer: string,
    initialLength = 0,
) => {
    const evidence = {
        revealedLength: 0,
        preHintCorrectChars: 0,
        exposures: [] as HintExposure[],
        unresolved: new Map<number, HintExposure>(),
        assisted: new Set<number>(),
    };
    revealAutomaticHint(evidence, answer, [], initialLength, true);
    return evidence;
};

type AutomaticHintEvidence = ReturnType<typeof createAutomaticHintEvidence>;

// Take this snapshot before a timed hint clears incorrect input. Correct cells
// (including a committed kana prefix) were already recalled without this cue.
export const revealAutomaticHint = (
    evidence: AutomaticHintEvidence,
    answer: string,
    input: readonly string[],
    length: number,
    initial = false,
) => {
    if (length <= evidence.revealedLength) return;
    const exposure: HintExposure = { initial, assisted: false };
    for (
        let i = evidence.revealedLength;
        i < Math.min(length, answer.length);
        i++
    ) {
        if (answer[i] === " ") continue;
        if (input[i] === answer[i]) evidence.preHintCorrectChars++;
        else evidence.unresolved.set(i, exposure);
    }
    evidence.revealedLength = length;
    evidence.exposures.push(exposure);
};

// This is an observable proxy for reliance, not a claim about where the user
// looked. Only correct commits to previously unresolved, exposed cells count.
// Keep the evidence across retries/Backspace and count each position once.
export const recordAutomaticHintInput = (
    evidence: AutomaticHintEvidence,
    answer: string,
    input: readonly string[],
    start: number,
    advance: number,
) => {
    for (let i = start; i < Math.min(start + advance, answer.length); i++) {
        const exposure = evidence.unresolved.get(i);
        if (exposure && input[i] === answer[i]) {
            exposure.assisted = true;
            evidence.assisted.add(i);
        }
    }
};

export const summarizeAutomaticHintEvidence = (
    evidence: AutomaticHintEvidence,
    answer: string,
) => {
    const assistedPositions = [...evidence.assisted].sort((a, b) => a - b);
    const used = evidence.exposures.filter((exposure) => exposure.assisted);
    const initialAssisted = assistedPositions.filter(
        (position) => evidence.unresolved.get(position)?.initial,
    ).length;
    const letterCount = Array.from(answer).filter(
        (char) => char !== " ",
    ).length;
    return {
        hintDiagnostics: {
            version: "auto-hint-input-v1",
            displayedHintCount: evidence.exposures.length,
            preHintCorrectChars: evidence.preHintCorrectChars,
            assistedHintChars: assistedPositions.length,
        },
        assistedPositions,
        hintCount: used.length,
        additionalHintCount: used.filter((exposure) => !exposure.initial)
            .length,
        initialCueRatio: initialAssisted / Math.max(1, answer.length),
        finalCueRatio: assistedPositions.length / Math.max(1, answer.length),
        // A fully visible overlay need not mean full reliance: previously
        // recalled cells remain independent evidence, even after an input reset.
        answerWasFullyRevealed:
            letterCount > 0 && assistedPositions.length === letterCount,
    };
};
