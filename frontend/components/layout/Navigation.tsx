"use client";

import { usePathname, useRouter } from "next/navigation";
import {
    createContext,
    useContext,
    useEffect,
    useLayoutEffect,
    useRef,
    type ReactNode,
} from "react";
import "./navigation.css";
import { slideFrames, getSlideMotion, prefersReducedMotion } from "./slide-motion";
import { animateSlideEntrance, beginNativeSlideCursor, endNativeSlideCursor } from "./slide-cursor";

export type NavigationDirection = "push" | "pop";
export type NavigationTransition = "slide" | "morph";
type NavigationOptions = { transition: "morph"; source: HTMLElement };

type Navigate = (
    href: string,
    direction: NavigationDirection,
    preventDefault: () => void,
    options?: NavigationOptions,
) => void;

type Request = {
    target: string;
    direction: NavigationDirection;
    timer?: ReturnType<typeof setTimeout>;
    complete?: () => void;
    transition?: ViewTransition;
    morph?: { source: HTMLElement; key?: string; destination?: HTMLElement };
};

const NavigationContext = createContext<Navigate | null>(null);
const RootNavigationContext = createContext<Navigate | null>(null);
const normalize = (path: string) => path.replace(/\/+$/, "") || "/";

// Measure the responsive Shell content, not the full clipping viewport.
function navigationWidth(viewport: HTMLElement) {
    const shell = viewport.querySelector<HTMLElement>("[data-navigation-shell-width]");
    return shell?.offsetWidth || viewport.clientWidth;
}

function clearTransitionStyles() {
    const root = document.documentElement;
    delete root.dataset.etbNavigation;
    root.style.removeProperty("--etb-navigation-old-width");
    root.style.removeProperty("--etb-navigation-new-width");
}

export function useNavigation(scope: "local" | "root" = "local") {
    const local = useContext(NavigationContext);
    const root = useContext(RootNavigationContext);
    return scope === "root" ? root : local ?? root;
}

function clearMorph(request: Request) {
    const morph = request.morph;
    if (!morph) return;
    morph.source.style.removeProperty("view-transition-name");
    morph.destination?.style.removeProperty("view-transition-name");
}

function stop(request: Request, skip = false) {
    clearTimeout(request.timer);
    if (skip) request.transition?.skipTransition();
    request.complete?.();
}

export default function Navigation({ children, root = false }: { children: ReactNode; root?: boolean }) {
    const router = useRouter();
    const pathname = usePathname();
    const viewport = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const pending = useRef<Request | null>(null);
    const active = useRef<Request | null>(null);
    const animation = useRef<Animation | null>(null);

    function cancel() {
        if (pending.current) stop(pending.current, true);
        pending.current = null;
        if (active.current) {
            stop(active.current, true);
            clearMorph(active.current);
        }
        active.current = null;
        animation.current?.cancel();
        animation.current = null;
        // Nested navigation instances must not clear another instance’s transition.
        if (viewport.current?.style.viewTransitionName === "etb-navigation-content") {
            clearTransitionStyles();
            viewport.current.style.viewTransitionName = "";
            endNativeSlideCursor();
        }
    }

    useEffect(() => {
        // Ordinary sidebar links and browser history are not explicit push/pop.
        function onSidebarClick(event: MouseEvent) {
            if (
                event.button === 0 && !event.metaKey && !event.ctrlKey &&
                !event.shiftKey && !event.altKey &&
                event.target instanceof Element &&
                event.target.closest("[data-sidebar-navigation] a")
            ) cancel();
        }
        window.addEventListener("popstate", cancel);
        document.addEventListener("click", onSidebarClick, true);
        return () => {
            window.removeEventListener("popstate", cancel);
            document.removeEventListener("click", onSidebarClick, true);
            cancel();
        };
    }, []);

    useLayoutEffect(() => {
        const request = pending.current;
        if (!request || !pathname) return;
        pending.current = null;
        const matches = normalize(pathname) === request.target;
        const width = viewport.current ? navigationWidth(viewport.current) : 0;
        if (matches && request.transition && request.morph) {
            const { source, key } = request.morph;
            const targets = viewport.current?.querySelectorAll<HTMLElement>("[data-navigation-morph-target]");
            const destination = Array.from(targets ?? []).find((element) =>
                element !== source && (key === undefined || element.dataset.navigationMorphTarget === key),
            );
            // A gate, error, or list without the original room must never morph into another room.
            if (!destination || !destination.getBoundingClientRect().height || !destination.getBoundingClientRect().width) {
                stop(request, true);
                return;
            }
            if (request.direction === "pop") {
                // Restore visibility before capturing the destination, including cards below the fold.
                destination.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
            }
            request.morph.source.style.removeProperty("view-transition-name");
            request.morph.destination = destination;
            destination.style.viewTransitionName = "etb-navigation-morph";
        }
        if (matches && request.transition && width > 0) {
            document.documentElement.style.setProperty("--etb-navigation-new-width", `${width}px`);
        }
        if (matches && request.transition) beginNativeSlideCursor();
        stop(request, !matches);
        if (request.transition || !matches ||
            prefersReducedMotion()) return;

        // Older browsers still get a directional entrance without snapshots.
        if (!width) return;
        animation.current?.cancel();
        const { timing, offset } = getSlideMotion();
        animation.current = content.current ? animateSlideEntrance(
            content.current,
            slideFrames(request.direction === "push" ? "push-in" : "under-in", width, offset),
            timing,
        ) : null;
    }, [pathname]);

    const navigate: Navigate = (href, direction, preventDefault, options) => {
        cancel();
        const node = viewport.current;
        if (!node || prefersReducedMotion()) return;
        const url = new URL(href, window.location.href);
        const target = normalize(url.pathname);
        if (url.origin !== window.location.origin ||
            target === normalize(window.location.pathname)) return;

        const request: Request = { target, direction };
        pending.current = request;

        if (typeof document.startViewTransition === "function") {
            const root = document.documentElement;
            const width = navigationWidth(node);
            if (width > 0) {
                root.style.setProperty("--etb-navigation-old-width", `${width}px`);
                root.style.setProperty("--etb-navigation-new-width", `${width}px`);
            }
            node.style.viewTransitionName = "etb-navigation-content";
            const source = options?.source;
            const rect = source?.getBoundingClientRect();
            if (options?.transition === "morph" && source && node.contains(source) && rect?.width && rect.height) {
                request.morph = { source, key: source.dataset.navigationMorphTarget };
                source.style.viewTransitionName = "etb-navigation-morph";
            }
            root.dataset.etbNavigation = request.morph ? "morph" : direction;
            active.current = request;
            try {
                const transition = document.startViewTransition(async () => {
                    if (pending.current !== request) return;
                    const committed = new Promise<void>((resolve) => {
                        request.complete = resolve;
                        // Do not freeze the old screen during a slow server response.
                        request.timer = setTimeout(() => {
                            if (pending.current === request) pending.current = null;
                            stop(request, true);
                        }, 500);
                    });
                    router.push(href);
                    await committed;
                });
                request.transition = transition;
                preventDefault();
                const cleanup = () => {
                    if (active.current !== request) return;
                    active.current = null;
                    clearMorph(request);
                    clearTransitionStyles();
                    node.style.viewTransitionName = "";
                    endNativeSlideCursor();
                };
                void transition.ready.catch(() => {});
                void transition.finished.then(cleanup, cleanup);
                return;
            } catch {
                active.current = null;
                clearMorph(request);
                request.morph = undefined;
                clearTransitionStyles();
                node.style.viewTransitionName = "";
            }
        }

        // Keep Next Link's native navigation/prefetch behavior in the fallback.
        request.timer = setTimeout(() => {
            if (pending.current === request) pending.current = null;
        }, 5000);
    };

    const Context = root ? RootNavigationContext : NavigationContext;
    return (
        <Context.Provider value={navigate}>
            <div ref={viewport} className="min-w-0 w-full overflow-x-clip">
                <div ref={content}>{children}</div>
            </div>
        </Context.Provider>
    );
}
