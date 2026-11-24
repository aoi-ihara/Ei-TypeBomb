"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
    canHandleSelectionSpace,
    canCountSelectionSpaceKeyDown,
    isGameSpaceKeyDown,
    isSpaceKey,
    isDualRoleSpaceRelease,
    nextSelectionSpacePress,
} from "@/lib/selection-shortcut";

type Options = {
    questionRef: RefObject<HTMLDivElement | null>;
    disabled: boolean;
    allowHint: boolean;
    hintUsed: boolean;
    revealHint: () => void;
    onOtherKeyDown: (event: KeyboardEvent) => void;
};

// A common physical-key state machine for selection and card practice.
export function useSelectionShortcuts({
    questionRef, disabled, allowHint, hintUsed, revealHint, onOtherKeyDown,
}: Options) {
    const lastKeyWasSpaceRef = useRef(false);
    const spaceKeyHandledRef = useRef(false);
    const spaceKeyDownRef = useRef(false);

    useEffect(() => {
        lastKeyWasSpaceRef.current = false;
        spaceKeyHandledRef.current = false;
        spaceKeyDownRef.current = false;
    }, [disabled, allowHint]);

    useEffect(() => {
        if (hintUsed) lastKeyWasSpaceRef.current = false;
    }, [hintUsed]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.isComposing ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey
            ) {
                lastKeyWasSpaceRef.current = false;
                return;
            }

            const target = event.target;
            const isEditable =
                target instanceof HTMLElement &&
                (target.isContentEditable ||
                    Boolean(target.closest("input, textarea, select")));
            if (isEditable) {
                lastKeyWasSpaceRef.current = false;
                return;
            }

            // Dual-role Space/Shift keyboards may send Shift keydown between
            // two short Space taps. It must not cancel an armed shortcut.
            if (isDualRoleSpaceRelease(event)) return;

            const isInteractive =
                target instanceof Element &&
                Boolean(
                    target.closest(
                        "button, a, summary, [role='button'], [role='link']",
                    ),
                );
            const isInsideQuestion =
                target instanceof Node &&
                questionRef.current?.contains(target) === true;

            if (allowHint && isSpaceKey(event)) {
                if (
                    disabled ||
                    hintUsed ||
                    !canHandleSelectionSpace(
                        isEditable,
                        isInteractive,
                        isInsideQuestion,
                    )
                ) {
                    lastKeyWasSpaceRef.current = false;
                    return;
                }

                // Prevent scrolling and the native click of a focused answer
                // button. Its focus must not disable the double-Space hint.
                event.preventDefault();
                spaceKeyHandledRef.current = true;
                // Count physical down/up cycles, rather than trusting repeat
                // alone (synthetic/accessibility events may omit that flag).
                // Only an actual release can separate two presses. Some
                // Space/Shift remappers release Shift instead of Space.
                if (
                    !isGameSpaceKeyDown(event) ||
                    !canCountSelectionSpaceKeyDown(
                        event.repeat,
                        spaceKeyDownRef.current,
                    )
                )
                    return;
                spaceKeyDownRef.current = true;

                const { armed, reveal } = nextSelectionSpacePress(
                    lastKeyWasSpaceRef.current,
                    true,
                );
                lastKeyWasSpaceRef.current = armed;
                if (reveal) revealHint();
                return;
            }

            lastKeyWasSpaceRef.current = false;
            if (
                event.repeat ||
                disabled ||
                event.defaultPrevented ||
                (isInteractive && !isInsideQuestion)
            ) return;

            // Enter activates a focused control natively. Only use the
            // background Enter shortcut when no interactive element owns it.
            if (event.key === "Enter" && isInteractive) return;
            onOtherKeyDown(event);
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (!isSpaceKey(event)) {
                // A dual-role Space/Shift mapper can emit Shift keyup after
                // a short Space keydown. Do not mistake unrelated Shift use
                // for a release if another keydown broke the Space sequence.
                if (
                    spaceKeyDownRef.current &&
                    lastKeyWasSpaceRef.current &&
                    isDualRoleSpaceRelease(event)
                ) {
                    spaceKeyDownRef.current = false;
                    spaceKeyHandledRef.current = false;
                }
                return;
            }
            // Some browsers activate a focused button on Space keyup, not
            // keydown. Suppress that click for consumed hint shortcuts only.
            spaceKeyDownRef.current = false;
            if (spaceKeyHandledRef.current) {
                event.preventDefault();
                spaceKeyHandledRef.current = false;
            }
        };

        const resetSequence = () => {
            lastKeyWasSpaceRef.current = false;
        };
        const onFocusIn = (event: FocusEvent) => {
            // Focus moving between controls within the active question is
            // still the same interaction; entering an editor or a control
            // outside the question cancels a partially armed shortcut.
            if (
                event.target instanceof Node &&
                questionRef.current?.contains(event.target)
            )
                return;
            resetSequence();
            spaceKeyDownRef.current = false;
            spaceKeyHandledRef.current = false;
        };
        const onBlur = () => {
            resetSequence();
            spaceKeyDownRef.current = false;
            spaceKeyHandledRef.current = false;
        };

        // A click/focus change starts a new interaction. In particular, do not
        // carry half a shortcut through an editor, a dialog, or another tab.
        window.addEventListener("blur", onBlur);
        window.addEventListener("focusin", onFocusIn);
        window.addEventListener("pointerdown", resetSequence, true);
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        return () => {
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("focusin", onFocusIn);
            window.removeEventListener("pointerdown", resetSequence, true);
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
        };
    }, [disabled, allowHint, hintUsed, revealHint, onOtherKeyDown, questionRef]);
}
