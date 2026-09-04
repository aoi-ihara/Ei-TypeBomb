export type Point = {
    x: number;
    y: number;
};

export type CircleScore = {
    score: number;
    center: Point;
    radius: number;
    radialError: number;
    angularCoverage: number;
    closureError: number;
};

type Candidate = {
    center: Point;
    radius: number;
    votes: number;
    radialError: number;
    angularCoverage: number;
};

const MAX_POINTS = 260;
const RADIUS_STEPS = 56;
const ANGLE_STEPS = 48;
const CENTER_QUANTIZATION = 4;
const ANGULAR_BINS = 72;

function distance(a: Point, b: Point) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function resample(points: Point[], maxPoints: number) {
    if (points.length <= maxPoints) return points;

    const stride = (points.length - 1) / (maxPoints - 1);
    return Array.from({ length: maxPoints }, (_, index) => {
        return points[Math.round(index * stride)];
    });
}

function range(min: number, max: number, steps: number) {
    if (steps <= 1) return [min];

    return Array.from({ length: steps }, (_, index) => {
        return min + ((max - min) * index) / (steps - 1);
    });
}

function quantize(value: number) {
    return Math.round(value / CENTER_QUANTIZATION) * CENTER_QUANTIZATION;
}

export function scoreCircle(points: Point[], canvasWidth: number, canvasHeight: number): CircleScore | null {
    if (points.length < 12) return null;

    const sampled = resample(points, MAX_POINTS);
    const xs = sampled.map((point) => point.x);
    const ys = sampled.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const diameter = Math.min(maxX - minX, maxY - minY);

    if (diameter < 48) return null;

    const centerGuess = {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
    };

    const centerRange = Math.max(18, diameter * 0.24);
    const radiusMin = Math.max(18, diameter * 0.28);
    const radiusMax = Math.min(
        Math.max(radiusMin + 8, diameter * 0.72),
        Math.min(canvasWidth, canvasHeight) * 0.46,
    );

    const radii = range(radiusMin, radiusMax, RADIUS_STEPS);
    const centerSteps = 15;
    const candidateMap = new Map<string, Candidate>();

    for (const radius of radii) {
        for (const angle of range(0, Math.PI * 2, ANGLE_STEPS + 1).slice(0, ANGLE_STEPS)) {
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            for (const point of sampled) {
                const center = {
                    x: quantize(point.x - cos * radius),
                    y: quantize(point.y - sin * radius),
                };

                const deltaX = center.x - centerGuess.x;
                const deltaY = center.y - centerGuess.y;
                const centerDistance = Math.hypot(deltaX, deltaY);

                if (centerDistance > centerRange) continue;

                const key = `${center.x}|${center.y}|${Math.round(radius / 2)}`;
                const existing = candidateMap.get(key);

                if (existing) {
                    existing.votes += 1;
                } else {
                    candidateMap.set(key, {
                        center,
                        radius,
                        votes: 1,
                        radialError: 0,
                        angularCoverage: 0,
                    });
                }
            }
        }
    }

    const candidates = Array.from(candidateMap.values())
        .sort((a, b) => b.votes - a.votes)
        .slice(0, 80);

    if (!candidates.length) return null;

    const evaluated = candidates.map((candidate) => {
        let radialError = 0;
        const bins = new Set<number>();

        for (const point of sampled) {
            const radius = distance(point, candidate.center);
            const normalizedError = Math.abs(radius - candidate.radius) / candidate.radius;
            radialError += normalizedError;

            if (normalizedError <= 0.12) {
                const theta = Math.atan2(
                    point.y - candidate.center.y,
                    point.x - candidate.center.x,
                );
                const normalizedTheta = theta < 0 ? theta + Math.PI * 2 : theta;
                bins.add(
                    Math.min(
                        ANGULAR_BINS - 1,
                        Math.floor(
                            (normalizedTheta / (Math.PI * 2)) * ANGULAR_BINS,
                        ),
                    ),
                );
            }
        }

        return {
            ...candidate,
            radialError: radialError / sampled.length,
            angularCoverage: bins.size / ANGULAR_BINS,
        };
    });

    evaluated.sort((a, b) => {
        const scoreA = a.angularCoverage * 0.62 + Math.max(0, 1 - a.radialError * 2.6) * 0.38;
        const scoreB = b.angularCoverage * 0.62 + Math.max(0, 1 - b.radialError * 2.6) * 0.38;
        return scoreB - scoreA;
    });

    const best = evaluated[0];
    const closureError = Math.min(
        1,
        distance(sampled[0], sampled[sampled.length - 1]) /
            (Math.PI * best.radius),
    );

    const radialScore = Math.max(0, 1 - best.radialError * 3.1);
    const coverageScore = Math.min(1, best.angularCoverage / 0.82);
    const closureScore = Math.max(0, 1 - closureError * 2.8);

    const score = Math.round(
        Math.max(
            0,
            Math.min(
                100,
                coverageScore * 42 + radialScore * 43 + closureScore * 15,
            ),
        ),
    );

    return {
        score,
        center: best.center,
        radius: best.radius,
        radialError: best.radialError,
        angularCoverage: best.angularCoverage,
        closureError,
    };
}
