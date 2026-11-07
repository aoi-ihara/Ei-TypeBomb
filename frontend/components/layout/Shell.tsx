"use client";

import ProgressSignal from "./ProgressSignal";
import { Icon } from "../ui/Icon";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import Link from "next/link";
import Button from "../ui/Button";

type AuthShellProps = {
    title?: string;
    children?: React.ReactNode;
    className?: string;
    size?: "small" | "medium" | "large" | "xlarge";
    loading?: boolean;
    animateAppear?: boolean;
    showBackButton?: boolean;
    backLink?: string;
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
}: AuthShellProps) {
    const router = useRouter();

    if (loading) return <ProgressSignal />;

    return (
        <div className="flex flex-col items-center w-full">
            {title && (
                <div
                    className={`relative mb-8 flex items-center ${showBackButton && "max-w-[calc(100vw-32px)]"} px-8`}
                >
                    {(showBackButton || backLink) && (
                        <Button
                            variant="text"
                            iconName="arrowLeft"
                            padding="small"
                            href={backLink ?? undefined}
                            onClick={
                                !backLink
                                    ? () => {
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
                className={`pb-[50vh] ${
                    size == "small"
                        ? "max-w-xs"
                        : size === "medium"
                          ? "max-w-md"
                          : size === "large"
                            ? "max-w-2xl"
                            : "max-w-4xl"
                } w-full ${className} ${
                    animateAppear && "animate-appear origin-top"
                }`}
            >
                {children}
            </div>
        </div>
    );
}
