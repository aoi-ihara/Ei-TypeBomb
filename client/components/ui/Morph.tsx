"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

export type MorphProps = {
    first: ReactNode;
    last: ReactNode;
    /** false displays first; true displays last. */
    state: boolean;
};

type Size = { width: number; height: number };
type Frame = Size & { mix: number };

export default function Morph({ first, last, state }: MorphProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const firstRef = useRef<HTMLDivElement>(null);
    const lastRef = useRef<HTMLDivElement>(null);
    const updateRef = useRef<(() => void) | null>(null);
    const stateRef = useRef(state);

    useLayoutEffect(() => {
        const root = rootRef.current!;
        const layers = [firstRef.current!, lastRef.current!];
        const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
        let sizes: Size[] = [];
        let current: Frame | undefined;
        let frameId = 0;
        let clock: Animation | undefined;
        let offset = { x: 0, y: 0 };

        const measure = (element: HTMLElement): Size => {
            const css = getComputedStyle(element);
            return {
                width: parseFloat(css.width),
                height: parseFloat(css.height),
            };
        };
        const setPointerEvents = (animating: boolean) => {
            layers.forEach((layer, index) => {
                const active = stateRef.current === (index === 1);

                layer.style.pointerEvents =
                    !animating && active ? "auto" : "none";
            });
        };
        const center = () => {
            const rect = root.getBoundingClientRect();
            return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
            };
        };
        const paint = (next: Frame, preserveCenter = false) => {
            const anchor = preserveCenter ? center() : undefined;
            root.style.width = `${next.width}px`;
            root.style.height = `${next.height}px`;
            layers.forEach((layer, index) => {
                const size = sizes[index];
                const x = size.width > 0 ? next.width / size.width : 1;
                const y = size.height > 0 ? next.height / size.height : 1;
                layer.style.transform = `translate(-50%, -50%) scale(${x}, ${y})`;
                layer.style.opacity = String(
                    index === 0 ? 1 - next.mix : next.mix,
                );
            });
            if (anchor) {
                const actual = center();
                offset = {
                    x: offset.x + anchor.x - actual.x,
                    y: offset.y + anchor.y - actual.y,
                };
                root.style.translate = `${offset.x}px ${offset.y}px`;
            }
            current = next;
            root.style.visibility = "visible";
        };
        const stop = () => {
            cancelAnimationFrame(frameId);
            clock?.cancel();
            clock = undefined;
        };
        const update = () => {
            const measured = layers.map(measure);
            const index = stateRef.current ? 1 : 0;
            const target = { ...measured[index], mix: index };
            const unchanged =
                sizes.length > 0 &&
                measured.every(
                    (size, i) =>
                        size.width === sizes[i].width &&
                        size.height === sizes[i].height,
                );
            if (
                unchanged &&
                current &&
                current.width === target.width &&
                current.height === target.height &&
                current.mix === target.mix
            )
                return;

            stop();
            sizes = measured;
            if (!current) {
                paint(target);
                setPointerEvents(false);
                return;
            }
            const start = current;
            const css = getComputedStyle(root);
            const durationToken = css.getPropertyValue("--duration-etb").trim();
            const duration =
                parseFloat(durationToken || "400") *
                (durationToken.endsWith("ms") || !durationToken ? 1 : 1000);
            if (motion.matches || !Number.isFinite(duration) || duration <= 0) {
                paint(target, true);
                setPointerEvents(false);
                return;
            }
            clock = new Animation(
                new KeyframeEffect(root, [], {
                    duration,
                    easing: css.getPropertyValue("--ease-etb").trim() || "ease",
                    fill: "both",
                }),
                document.timeline,
            );
            setPointerEvents(true);
            clock.play();
            paint(start, true);
            const tick = () => {
                const progress =
                    clock?.effect?.getComputedTiming().progress ?? 0;
                const done = Number(clock?.currentTime ?? 0) >= duration;
                const lerp = (a: number, b: number) => a + (b - a) * progress;
                paint(
                    done
                        ? target
                        : {
                              width: Math.max(
                                  0,
                                  lerp(start.width, target.width),
                              ),
                              height: Math.max(
                                  0,
                                  lerp(start.height, target.height),
                              ),
                              mix: Math.min(
                                  1,
                                  Math.max(0, lerp(start.mix, target.mix)),
                              ),
                          },
                    true,
                );
                if (done) {
                    stop();
                    setPointerEvents(false);
                } else frameId = requestAnimationFrame(tick);
            };
            frameId = requestAnimationFrame(tick);
        };

        updateRef.current = update;
        update();
        const observer = new ResizeObserver(update);
        layers.forEach((layer) => observer.observe(layer));
        motion.addEventListener("change", update);
        return () => {
            stop();
            observer.disconnect();
            motion.removeEventListener("change", update);
            updateRef.current = null;
        };
    }, []);

    useLayoutEffect(() => {
        stateRef.current = state;
        updateRef.current?.();
    }, [state, first, last]);

    return (
        <div
            ref={rootRef}
            data-morph={state ? "last" : "first"}
            style={{
                position: "relative",
                display: "inline-block",
                flex: "none",
                verticalAlign: "middle",
                visibility: "hidden",
            }}
        >
            {(["first", "last"] as const).map((side, index) => (
                <div
                    key={side}
                    ref={index === 0 ? firstRef : lastRef}
                    data-morph-layer={side}
                    aria-hidden={state !== (index === 1)}
                    inert={state !== (index === 1)}
                    style={{
                        position: "absolute",
                        display: "flow-root",
                        width: "max-content",
                        left: "50%",
                        top: "50%",
                        transformOrigin: "center",
                        // The animation lifecycle controls interaction after mount.
                        pointerEvents: "none",
                    }}
                >
                    {index === 0 ? first : last}
                </div>
            ))}
        </div>
    );
}
