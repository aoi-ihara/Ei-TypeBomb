import Link from "next/link";
import { Icon } from "../ui/Icon";

type AuthShellProps = {
    title?: string;
    children?: React.ReactNode;
    className?: string;
    size?: "large" | "small" | "medium";
    loading?: boolean;
    animateAppear?: boolean;
    back?: string;
};

export default function Shell({
    title,
    children,
    className = "flex flex-col gap-4 items-center px-4",
    size = "medium",
    loading,
    animateAppear = false,
    back,
}: AuthShellProps) {
    return (
        <>
            {(title || loading) && (
                <div
                    className={`relative mt-16 mb-8 flex items-center ${back && "max-w-[calc(100vw-32px)]"} px-8`}
                >
                    {back && (
                        <div
                            className="absolute -left-4 top-1/2 -translate-y-1/2 rounded-lg bg-(--color-background)"
                            data-cursor="button"
                            data-cursor-shape="1"
                        >
                            <Link
                                href={back}
                                className="duration-(--duration-etb) ease-etb p-3 flex active:scale-95"
                            >
                                <Icon name="arrowLeft" />
                            </Link>
                        </div>
                    )}
                    <h1
                        className={`w-fit max-w-full text-2xl font-bold font-mono ${
                            !title && loading && "gradient-text"
                        }`}
                        data-cursor="text"
                    >
                        {title ? title : "読み込み中…"}
                    </h1>
                </div>
            )}

            <div
                className={`pb-[50vh] ${
                    size === "medium"
                        ? "max-w-md"
                        : size === "large"
                          ? "max-w-2xl"
                          : "max-w-xs"
                } w-full ${className} ${
                    !loading && animateAppear && "animate-appear origin-top"
                }`}
            >
                {title && loading && (
                    <div className="w-full flex justify-center">
                        <div
                            className="w-fit gradient-text font-mono font-bold"
                            data-cursor="text"
                        >
                            読み込み中…
                        </div>
                    </div>
                )}

                {!loading && children}
            </div>
        </>
    );
}
