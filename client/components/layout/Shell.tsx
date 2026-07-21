type AuthShellProps = {
    title: string;
    children: React.ReactNode;
    className?: string;
    size?: "large" | "small" | "medium";
    loading?: boolean;
};

export default function Shell({
    title,
    children,
    className = "flex flex-col gap-4 items-center",
    size = "medium",
    loading,
}: AuthShellProps) {
    return (
        <>
            <h1
                className={`w-fit text-2xl mt-16 mb-8 font-bold font-mono text-center ${loading && "gradient-text"}`}
                data-cursor="text"
            >
                {title}
            </h1>
            <div
                className={`px-4 ${size == "medium" ? "max-w-md" : size == "large" ? "max-w-2xl" : "max-w-xs"} w-full ${className}`}
            >
                {children}
            </div>
        </>
    );
}
