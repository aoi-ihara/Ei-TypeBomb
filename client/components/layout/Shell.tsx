type AuthShellProps = {
    title?: string;
    children: React.ReactNode;
    className?: string;
    size?: "large" | "small" | "medium";
    loading?: boolean;
    animateAppear?: boolean;
};

export default function Shell({
    title,
    children,
    className = "flex flex-col gap-4 items-center",
    size = "medium",
    loading,
    animateAppear = false,
}: AuthShellProps) {
    return (
        <>
            {(title || loading) && (
                <h1
                    className={`w-fit text-2xl mt-16 mb-8 font-bold font-mono text-center ${!title && loading && "gradient-text"}`}
                    data-cursor="text"
                >
                    {title ? title : "Loading…"}
                </h1>
            )}
            <div
                className={`px-4 pb-[50vh] ${size === "medium" ? "max-w-md" : size === "large" ? "max-w-2xl" : "max-w-xs"} w-full ${className} ${!loading && animateAppear && "animate-appear origin-top"}`}
            >
                {title && loading && (
                    <div className="w-full flex justify-center">
                        <div
                            className="w-fit gradient-text fonr-mono font-bold"
                            data-cursor="text"
                        >
                            Loading…
                        </div>
                    </div>
                )}
                {!loading && children}
            </div>
        </>
    );
}
