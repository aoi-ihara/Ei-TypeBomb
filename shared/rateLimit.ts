export const EVENT_RATE_LIMITS: Record<string, { capacity: number; perSecond: number }> = {
    currentInput: { capacity: 60, perSecond: 30 },
    "word:success": { capacity: 10, perSecond: 5 },
    "room:join": { capacity: 5, perSecond: 2 },
    "room:leave": { capacity: 5, perSecond: 2 },
    "game:start": { capacity: 2, perSecond: 1 },
    "auth:response": { capacity: 3, perSecond: 0.5 },
    "health:ping": { capacity: 2, perSecond: 0.2 },
    "health:database": { capacity: 2, perSecond: 0.2 },
};
