import { User, Position } from "@/type";

export const newPositions = (users: User[], positions: Position[]) => {
    return positions.map((position, index) => {
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
                x: Math.cos(angle) * (users.length * 4 + 8),
                y: Math.sin(angle) * (users.length * 4 + 8),
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
    });
};
