import {
    DefaultScheduler,
    Rating,
    type DefaultSchedulerCard,
    type Grade,
} from "ts-fsrs";

/**
 * FSRS-7 is intentionally isolated from the existing Playground memory model.
 * This module does not read or mutate legacy ItemMemoryState objects.
 */
export const MEMORY_MODEL_VERSION = "FSRS-7" as const;
export const MEMORY_CONFIG_VERSION = 1 as const;
export const TARGET_RETENTION = 0.9;

export type LearningMode = "recall" | "recognition";
export type MemoryCard = DefaultSchedulerCard<"FSRS-7">;

export type CardIdentity = {
    roomId: string;
    itemId: string;
    mode: LearningMode;
};

export type AnswerObservation = {
    // The first unassisted answer is the only evidence for a successful review.
    firstAttemptCorrect: boolean;
    usedHint: boolean;
    // This is explicit difficulty evidence, not a raw response-time threshold.
    struggled: boolean;
};

const schedulerPromise = DefaultScheduler({
    version: MEMORY_MODEL_VERSION,
    desiredRetention: TARGET_RETENTION,
    enableShortTerm: true,
    learningSteps: ["1m", "10m"],
    relearningSteps: ["10m"],
    enableFuzz: false,
});

export function cardId({ roomId, itemId, mode }: CardIdentity): string {
    return JSON.stringify([roomId, itemId, mode]);
}

export function evaluateAnswer(answer: AnswerObservation): Grade {
    if (!answer.firstAttemptCorrect || answer.usedHint) return Rating.Again;
    return answer.struggled ? Rating.Hard : Rating.Good;
}

export async function createMemoryCard(
    identity: CardIdentity,
    now: Date = new Date(),
): Promise<MemoryCard> {
    const scheduler = await schedulerPromise;
    return scheduler.newCard({ cardId: cardId(identity), now });
}

export async function reviewMemoryCard(
    card: MemoryCard,
    answer: AnswerObservation,
    now: Date = new Date(),
) {
    const scheduler = await schedulerPromise;
    // The result contains a new immutable card and a revlog. Persist both
    // atomically when the database integration is introduced.
    return scheduler.review({ card, grade: evaluateAnswer(answer), now });
}

/** null means there has not yet been an independent reviewed memory anchor. */
export async function predictRetention(
    card: MemoryCard,
    at: Date = new Date(),
): Promise<number | null> {
    if (card.scheduleStatus === "new" || !card.lastReviewAt) return null;

    const scheduler = await schedulerPromise;
    const elapsedDays = Math.max(
        0,
        scheduler.chrono.difference(card.lastReviewAt, at),
    );
    return scheduler.model.forgettingCurve(card, elapsedDays);
}
