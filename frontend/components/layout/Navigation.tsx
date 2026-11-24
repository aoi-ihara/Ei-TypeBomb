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

export type NavigationDirection = "push" | "pop";

type Navigate = (
    href: string,
    direction: NavigationDirection,
    preventDefault: () => void,
) => void;

type Request = {
    target: string;
    direction: NavigationDirection;
    timer?: ReturnType<typeof setTimeout>;
    complete?: () => void;
    transition?: ViewTransition;
};

const NavigationContext = createContext<Navigate | null>(null);
const normalize = (path: string) => path.replace(/\/+$/, "") || "/";

export function useNavigation() {
    return useContext(NavigationContext);
}

function stop(request: Request, skip = false) {
    clearTimeout(request.timer);
    if (skip) request.transition?.skipTransition();
    request.complete?.();
}

export default function Navigation({ children }: { children: ReactNode }) {
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
        if (active.current) stop(active.current, true);
        active.current = null;
        animation.current?.cancel();
        animation.current = null;
        delete document.documentElement.dataset.etbNavigation;
        if (viewport.current) viewport.current.style.viewTransitionName = "";
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
        stop(request, !matches);
        if (request.transition || !matches ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        // Older browsers still get a directional entrance without snapshots.
        animation.current?.cancel();
        animation.current = content.current?.animate(
            [
                { transform: `translateX(${request.direction === "push" ? "100%" : "-30%"})` },
                { transform: "translateX(0)" },
            ],
            { duration: 300, easing: "cubic-bezier(0.25, 0.8, 0.25, 1)" },
        ) ?? null;
    }, [pathname]);

    const navigate: Navigate = (href, direction, preventDefault) => {
        cancel();
        const node = viewport.current;
        if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const url = new URL(href, window.location.href);
        const target = normalize(url.pathname);
        if (url.origin !== window.location.origin ||
            target === normalize(window.location.pathname)) return;

        const request: Request = { target, direction };
        pending.current = request;

        if (typeof document.startViewTransition === "function") {
            node.style.viewTransitionName = "etb-navigation-content";
            document.documentElement.dataset.etbNavigation = direction;
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
                    delete document.documentElement.dataset.etbNavigation;
                    node.style.viewTransitionName = "";
                };
                void transition.ready.catch(() => {});
                void transition.finished.then(cleanup, cleanup);
                return;
            } catch {
                active.current = null;
                delete document.documentElement.dataset.etbNavigation;
                node.style.viewTransitionName = "";
            }
        }

        // Keep Next Link's native navigation/prefetch behavior in the fallback.
        request.timer = setTimeout(() => {
            if (pending.current === request) pending.current = null;
        }, 5000);
    };

    return (
        <NavigationContext.Provider value={navigate}>
            <div ref={viewport} className="min-w-0 w-full overflow-x-clip">
                <div ref={content}>{children}</div>
            </div>
        </NavigationContext.Provider>
    );
}
