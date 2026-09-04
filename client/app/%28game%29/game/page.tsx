"use client";

import { PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { scoreCircle, type Point, type CircleScore } from "@/lib/circle/hough";

const CANVAS_SIZE = 640;
const STROKE_WIDTH = 5;

type DrawState = "ready" | "drawing" | "result";

export default function CircleGame() {
    const router = useRouter();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const pointsRef = useRef<Point[]>([]);
    const drawingRef = useRef(false);
    const [state, setState] = useState<DrawState>("ready");
    const [result, setResult] = useState<CircleScore | null>(null);

    const getCanvasPoint = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY,
        };
    }, []);

    const renderPath = useCallback((points: Point[]) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d");
        if (!context) return;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = "hsl(0, 0%, 90%)";
        context.lineWidth = STROKE_WIDTH;
        context.lineCap = "round";
        context.lineJoin = "round";

        if (points.length < 2) return;

        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) {
            context.lineTo(point.x, point.y);
        }
        context.stroke();
    }, []);

    const clearCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;

        context.clearRect(0, 0, canvas.width, canvas.height);
        pointsRef.current = [];
    }, []);

    const finishDrawing = useCallback(() => {
        if (!drawingRef.current) return;
        drawingRef.current = false;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const points = pointsRef.current;
        const circle = scoreCircle(points, canvas.width, canvas.height);

        if (!circle) {
            setResult(null);
            setState("ready");
            return;
        }

        setResult(circle);
        setState("result");
    }, []);

    const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
        if (state === "result") return;

        event.currentTarget.setPointerCapture(event.pointerId);
        const point = getCanvasPoint(event);
        if (!point) return;

        drawingRef.current = true;
        pointsRef.current = [point];
        setState("drawing");
        renderPath(pointsRef.current);
    };

    const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return;

        const point = getCanvasPoint(event);
        if (!point) return;

        const previous = pointsRef.current.at(-1);
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 2) {
            return;
        }

        pointsRef.current.push(point);
        renderPath(pointsRef.current);
    };

    const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        finishDrawing();
    };

    useEffect(() => {
        const handlePointerCancel = () => finishDrawing();
        window.addEventListener("pointercancel", handlePointerCancel);
        return () => window.removeEventListener("pointercancel", handlePointerCancel);
    }, [finishDrawing]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d");
        if (!context) return;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = "hsl(0, 0%, 90%)";
        context.lineWidth = STROKE_WIDTH;
        context.lineCap = "round";
        context.lineJoin = "round";
    }, []);

    const handlePlayAgain = () => {
        setResult(null);
        setState("ready");
        clearCanvas();
    };

    return (
        <div className="flex min-h-dvh w-full flex-col items-center justify-center px-4 py-12">
            <div className="flex w-full max-w-3xl flex-col items-center gap-8">
                <div className="flex flex-col items-center gap-2 text-center">
                    <div data-cursor="text" className="text-3xl font-extrabold font-mono">
                        Draw a Circle
                    </div>
                    <div data-cursor="text" className="opacity-60">
                        マウスでできるだけ真円に近い円を描いてください。
                    </div>
                </div>

                <div className="w-full max-w-[640px] aspect-square rounded-3xl bg-(--color-background-secondary) p-2">
                    <canvas
                        ref={canvasRef}
                        width={CANVAS_SIZE}
                        height={CANVAS_SIZE}
                        className="block h-full w-full rounded-2xl touch-none"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                    />
                </div>

                <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
                    {state === "ready" && (
                        <div data-cursor="text" className="opacity-50">
                            ここに円を描いてください
                        </div>
                    )}

                    {state === "drawing" && (
                        <div data-cursor="text" className="opacity-50">
                            マウスを離すと判定します
                        </div>
                    )}

                    {state === "result" && result && (
                        <div className="flex flex-col items-center gap-2 animate-appear">
                            <div data-cursor="text" className="font-mono text-7xl font-extrabold">
                                {result.score}
                            </div>
                            <div data-cursor="text" className="opacity-60">
                                / 100
                            </div>
                        </div>
                    )}
                </div>

                {state === "result" && (
                    <div className="flex w-full max-w-xs flex-col gap-3 animate-appear">
                        <Button
                            variant="primary"
                            iconName="rotateCw"
                            onClick={handlePlayAgain}
                        >
                            Play Again
                        </Button>
                        <Button
                            variant="text"
                            onClick={() => router.push("/")}
                        >
                            Home
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
