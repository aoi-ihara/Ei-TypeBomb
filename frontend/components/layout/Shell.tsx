import ProgressSignal from "./ProgressSignal";
import BackButton from "./BackButton";
import { Icon } from "../ui/Icon";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";

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
        <>
            {title && (
                <div
                    className={`relative mt-16 mb-8 flex items-center ${showBackButton && "max-w-[calc(100vw-32px)]"} px-8`}
                >
                    {showBackButton && (
                        <div
                            className="absolute -left-4 top-1/2 -translate-y-1/2 rounded-lg bg-(--color-background)"
                            data-cursor="button"
                            data-cursor-shape="1"
                        >
                            <button
                                onClick={() => {
                                    startNavigationProgress();
                                    if (backLink) {
                                        router.push(backLink);
                                    } else {
                                        router.back();
                                    }
                                }}
                                className="duration-(--duration-etb) ease-etb p-3 flex active:scale-95"
                            >
                                <Icon name="arrowLeft" />
                            </button>
                        </div>
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
        </>
    );
}
