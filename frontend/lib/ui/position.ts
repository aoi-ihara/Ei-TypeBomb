import { User, Position } from "@/type";

export const newPositions = (users: User[], positions: Position[]) => {
    return Array.from(
        { length: Math.max(users.length, positions.length) },
        (_, index) => {
            if (users.length === 1 && index === 0) {
                return {
                    x: 0,
                    y: 0,
                    w: 64,
                    h: 64,
                    opacity: 1,
                };
            } else if (index < users.length) {
                const angle = (index / users.length) * 2 * Math.PI;
                return {
                    x: Math.cos(angle) * Math.min(42, users.length * 4 + 4),
                    y: Math.sin(angle) * Math.min(42, users.length * 4 + 4),
                    w: 24,
                    h: 24,
                    opacity: 1,
                };
            } else {
                return {
                    x: 0,
                    y: 0,
                    w: 24,
                    h: 24,
                    opacity: 0,
                };
            }
        },
    );
};
