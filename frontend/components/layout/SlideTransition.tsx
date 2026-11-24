"use client";

import { Component, createRef, type ReactNode } from "react";
import { prefersReducedMotion, slideFrames, getSlideMotion } from "./slide-motion";
import "./slide-motion.css";
import { animateSlideEntrance } from "./slide-cursor";

type Props = {
    children: ReactNode;
    transitionKey: number | string;
    enabled?: boolean;
    contentClassName?: string;
    /** Optional destination-based distance, independent of the clipping/layout width. */
    getDistance?: (element: HTMLElement) => number;
};

type Snapshot = {
    node: HTMLElement;
    width: number;
    height: number;
};

// Capture before React replaces the keyed question. The old view is only an
// inert DOM copy, never a second mounted input or a second set of game effects.
export default class SlideTransition extends Component<Props, object, Snapshot | null> {
    private live = createRef<HTMLDivElement>();
    private overlay = createRef<HTMLDivElement>();
    private incoming: Animation | null = null;
    private outgoing: Animation | null = null;

    private clear = () => {
        this.incoming?.cancel();
        this.outgoing?.cancel();
        this.incoming = null;
        this.outgoing = null;
        this.overlay.current?.replaceChildren();
    };

    getSnapshotBeforeUpdate(previous: Props): Snapshot | null {
        if (
            previous.transitionKey === this.props.transitionKey ||
            this.props.enabled === false || prefersReducedMotion()
        ) return null;
        const live = this.live.current;
        if (!live || !live.offsetWidth || typeof live.animate !== "function") return null;

        const node = live.cloneNode(true) as HTMLElement;
        node.inert = true;
        node.setAttribute("aria-hidden", "true");
        node.removeAttribute("id");
        node.querySelectorAll("[id], [name], [autofocus], [form]").forEach((child) => {
            for (const attribute of ["id", "name", "autofocus", "form"]) {
                child.removeAttribute(attribute);
            }
        });
        return { node, width: live.offsetWidth, height: live.offsetHeight };
    }

    componentDidUpdate(previous: Props, _state: object, snapshot: Snapshot | null) {
        if (previous.transitionKey === this.props.transitionKey) {
            if (this.props.enabled === false) this.clear();
            return;
        }
        this.clear();
        const live = this.live.current;
        const overlay = this.overlay.current;
        if (!snapshot || !live || !overlay || prefersReducedMotion()) return;

        const { node, width, height } = snapshot;
        Object.assign(node.style, {
            position: "absolute",
            top: "0",
            left: "50%",
            marginLeft: `${-width / 2}px`,
            width: `${width}px`,
            height: `${height}px`,
            pointerEvents: "none",
        });
        overlay.appendChild(node);

        const { timing, offset } = getSlideMotion();
        const distance = this.props.getDistance?.(live);
        const customDistance = typeof distance === "number" && Number.isFinite(distance) && distance > 0 ? distance : undefined;
        const outgoing = node.animate(slideFrames("under-out", customDistance ?? width, offset), {
            ...timing,
            fill: "forwards",
        });
        this.outgoing = outgoing;
        this.incoming = animateSlideEntrance(
            live,
            slideFrames("push-in", customDistance ?? live.offsetWidth, offset),
            timing,
        );
        const finish = () => {
            if (this.outgoing !== outgoing) return;
            node.remove();
            this.outgoing = null;
        };
        void outgoing.finished.then(finish, finish);
    }

    componentWillUnmount() {
        this.clear();
    }

    render() {
        return (
            <div className="relative isolate flex h-full min-w-0 w-full flex-col overflow-x-clip">
                <div
                    ref={this.overlay}
                    aria-hidden="true"
                    inert
                    className="absolute inset-0 pointer-events-none"
                />
                <div
                    ref={this.live}
                    className={`relative z-1 mx-auto flex h-full min-w-0 w-full flex-col ${this.props.contentClassName ?? ""}`}
                >
                    {this.props.children}
                </div>
            </div>
        );
    }
}
