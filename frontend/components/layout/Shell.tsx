"use client";

import { useRef } from "react";
import ProgressSignal from "./ProgressSignal";
import { useRouter } from "next/navigation";
import Button from "../ui/Button";
import Header from "./Header";

type ShellProps = {
    title?: string;
    children?: React.ReactNode;
    className?: string;
    size?: "small" | "medium" | "large" | "xlarge";
    loading?: boolean;
    animateAppear?: boolean;
    showBackButton?: boolean;
    backLink?: string;
    back?: string;
    onBackClicked?: () => void;
    showHeader?: boolean;
    morphTarget?: boolean | string;
};

export default function Shell({
    title,
    children,
    className = "flex flex-col gap-4 items-center px-4",
    size = "medium",
    loading,
    animateAppear = false,
    showBackButton = false,
    backLink,
    back,
    onBackClicked,
    showHeader = true,
    morphTarget = false,
}: ShellProps) {
    const router = useRouter();
    const morphRef = useRef<HTMLDivElement>(null);
    const backHref = back ?? backLink;

    if (loading) return <ProgressSignal />;

    const sizeClass = size === "small" ? "max-w-xs" : size === "medium"
        ? "max-w-md" : size === "large" ? "max-w-2xl" : "max-w-4xl";

    return (
        <>
            {showHeader && <Header />}
            <div className="flex flex-col items-center w-full">
                <div
                    ref={morphRef}
                    data-navigation-morph-target={typeof morphTarget === "string" ? morphTarget : morphTarget ? "" : undefined}
                    className={morphTarget ? `flex w-full flex-col items-center ${sizeClass}` : "contents"}
                >
                {title && (
                    <div
                        className={`relative mb-8 flex items-center ${(showBackButton || backHref) && "max-w-[calc(100vw-32px)]"} px-8`}
                    >
                        {(showBackButton || backHref) && (
                            <Button
                                variant="text"
                                aria-label="戻る"
                                iconName="arrowLeft"
                                padding="small"
                                href={backHref}
                                navigation={back ? "pop" : undefined}
                                navigationTransition={morphTarget ? "morph" : "slide"}
                                navigationMorphSource={morphTarget ? morphRef : undefined}
                                onClick={
                                    !backHref
                                        ? onBackClicked
                                            ? onBackClicked
                                            : () => {
                                                  router.back();
                                              }
                                        : undefined
                                }
                            />
                        )}
                        <h1
                            className="w-fit max-w-full text-2xl font-bold font-mono"
                            data-cursor="text"
                        >
                            {title}
                        </h1>
                    </div>
                )}

                <div
                    data-navigation-shell-width
                    className={`${morphTarget ? "" : "pb-[50vh]"} ${sizeClass} w-full ${className} ${
                        animateAppear && "animate-appear origin-top"
                    }`}
                >
                    {children}
                </div>
                </div>
                {morphTarget && <div className="w-full h-[50vh] shrink-0" aria-hidden="true" />}
            </div>
        </>
    );
}
