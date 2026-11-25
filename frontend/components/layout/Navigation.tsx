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
import { capturePageMorph, type PageMorph } from "./page-morph";

export type NavigationDirection = "push" | "pop";
export type NavigationTransition = "slide" | "morph";
type NavigationOptions = { transition: "morph"; source: HTMLElement } | { transition: "slide"; historyBack?: boolean };

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
    viewport?: HTMLElement;
    morph?: PageMorph;
    historyBack?: boolean;
    keepHeader?: boolean;
};

// View transitions are document-wide, even when Navigation providers are nested.
let documentTransition: { request: Request; cancel: () => void } | null = null;

const NavigationContext = createContext<Navigate | null>(null);
const RootNavigationContext = createContext<Navigate | null>(null);
const EditorBackContext = createContext<(() => void) | null>(null);

export function useEditorBack() { return useContext(EditorBackContext); }
const normalize = (path: string) => path.replace(/\/+$/, "") || "/";
const isEditorPath = (path: string) => /^\/[^/]+\/edit$/.test(normalize(path));

// Measure the responsive Shell content, not the full clipping viewport.
function navigationWidth(viewport: HTMLElement) {
    const shell = viewport.querySelector<HTMLElement>("[data-navigation-shell-width]");
    return shell?.offsetWidth || viewport.clientWidth;
}

function releaseDocumentTransition(request: Request) {
    if (documentTransition?.request !== request) return;
    documentTransition = null;
    const root = document.documentElement;
    delete root.dataset.etbNavigation;
    delete root.dataset.etbNavigationKeepHeader;
    root.style.removeProperty("--etb-navigation-old-width");
    root.style.removeProperty("--etb-navigation-new-width");
    endNativeSlideCursor();
}

export function useNavigation(scope: "local" | "root" = "local") {
    const local = useContext(NavigationContext);
    const root = useContext(RootNavigationContext);
    return scope === "root" ? root : local ?? root;
}

function clearMorph(request: Request) {
    request.morph?.dispose();
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
    const editorEntry = useRef<{ editor: string; from: string } | null>(null);

    function cancel() {
        if (pending.current) stop(pending.current, true);
        pending.current = null;
        const request = active.current;
        active.current = null;
        if (request) {
            stop(request, true);
            clearMorph(request);
            releaseDocumentTransition(request);
            request.viewport?.style.removeProperty("view-transition-name");
        }
        animation.current?.cancel();
        animation.current = null;
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
        function onPopState() {
            if (!pending.current?.historyBack) cancel();
        }
        window.addEventListener("popstate", onPopState);
        document.addEventListener("click", onSidebarClick, true);
        return () => {
            window.removeEventListener("popstate", onPopState);
            document.removeEventListener("click", onSidebarClick, true);
            cancel();
        };
    }, []);

    useLayoutEffect(() => {
        if (root && pathname && !isEditorPath(pathname)) editorEntry.current = null;
        const request = pending.current;
        if (!request || !pathname) return;
        pending.current = null;
        const matches = normalize(pathname) === request.target;
        const width = viewport.current ? navigationWidth(viewport.current) : 0;
        if (request.morph) {
            stop(request);
            // Next's scroll handling is disabled for morph navigation. Reset
            // push scrolling even if a redirect or password gate prevents morphing.
            if (request.direction === "push") {
                window.scrollTo({ top: 0, behavior: "instant" });
            }
            if (!matches) { cancel(); return; }
            const { source, key } = request.morph;
            const targets = viewport.current?.querySelectorAll<HTMLElement>("[data-navigation-morph-target]");
            const destination = Array.from(targets ?? []).find((element) =>
                element !== source && (key === undefined || element.dataset.navigationMorphTarget === key),
            );
            // A gate, error, or list without the original room must never morph into another room.
            if (!destination || !destination.getBoundingClientRect().height || !destination.getBoundingClientRect().width) {
                cancel();
                return;
            }
            if (request.direction === "pop") {
                // Restore visibility before capturing the destination, including cards below the fold.
                destination.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
            }
            request.morph.play(destination, () => {
                if (active.current !== request) return;
                active.current = null;
                releaseDocumentTransition(request);
            });
            return;
        }
        if (matches && request.transition && width > 0) {
            document.documentElement.style.setProperty("--etb-navigation-new-width", `${width}px`);
        }
        if (matches && request.transition) beginNativeSlideCursor();
        stop(request, !matches);
        if (request.transition || !matches ||
            prefersReducedMotion() || request.keepHeader) return;

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

        const current = normalize(window.location.pathname);
        const keepHeader = root && (isEditorPath(current) || isEditorPath(target));
        const historyBack = options?.transition === "slide" && options.historyBack;
        if (root && isEditorPath(target) && !isEditorPath(current)) {
            editorEntry.current = { editor: target, from: window.location.pathname + window.location.search + window.location.hash };
        }
        const request: Request = { target, direction, historyBack, keepHeader };
        pending.current = request;

        const source = options?.transition === "morph" ? options.source : undefined;
        if (options?.transition === "morph" && source && node.contains(source)) {
            documentTransition?.cancel();
            const morph = capturePageMorph(node, source);
            if (morph) {
                request.morph = morph;
                active.current = request;
                documentTransition = { request, cancel };
                // Loading and animation have independent lifetimes. The outgoing
                // page stays live until Next commits the destination.
                request.timer = setTimeout(() => {
                    if (pending.current === request) cancel();
                }, 15000);
                try {
                    router.push(href, { scroll: false });
                    preventDefault();
                    return;
                } catch {
                    cancel();
                    pending.current = request;
                    request.morph = undefined;
                }
            }
        }

        if (typeof document.startViewTransition === "function") {
            // Retire the old owner synchronously before assigning any shared names.
            documentTransition?.cancel();
            documentTransition = { request, cancel };
            request.viewport = node;
            const root = document.documentElement;
            const width = navigationWidth(node);
            if (width > 0) {
                root.style.setProperty("--etb-navigation-old-width", `${width}px`);
                root.style.setProperty("--etb-navigation-new-width", `${width}px`);
            }
            node.style.viewTransitionName = "etb-navigation-content";
            root.dataset.etbNavigation = direction;
            if (request.keepHeader) root.dataset.etbNavigationKeepHeader = "";
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
                    if (request.historyBack) router.back();
                    else router.push(href);
                    await committed;
                });
                request.transition = transition;
                preventDefault();
                const cleanup = () => {
                    if (active.current !== request) return;
                    active.current = null;
                    clearMorph(request);
                    releaseDocumentTransition(request);
                    node.style.viewTransitionName = "";
                };
                void transition.ready.catch(() => {});
                void transition.finished.then(cleanup, cleanup);
                return;
            } catch {
                active.current = null;
                clearMorph(request);
                request.morph = undefined;
                releaseDocumentTransition(request);
                node.style.viewTransitionName = "";
            }
        }

        // Keep Next Link's native navigation/prefetch behavior in the fallback.
        request.timer = setTimeout(() => {
            if (pending.current === request) pending.current = null;
        }, 5000);
    };

    function editorBack() {
        const entry = editorEntry.current;
        if (entry && isEditorPath(window.location.pathname)) {
            let handled = false;
            navigate(entry.from, "pop", () => { handled = true; }, { transition: "slide", historyBack: true });
            if (handled) return;
        }
        router.back();
    }

    const Context = root ? RootNavigationContext : NavigationContext;
    return (
        <Context.Provider value={navigate}>
            <div
                ref={viewport}
                className={`min-w-0 w-full overflow-x-clip ${root ? "h-full min-h-0 shrink-0" : ""}`}
            >
                <div ref={content} className={root ? "h-full" : undefined}>
                    {root ? <EditorBackContext.Provider value={editorBack}>{children}</EditorBackContext.Provider> : children}
                </div>
            </div>
        </Context.Provider>
    );
}
