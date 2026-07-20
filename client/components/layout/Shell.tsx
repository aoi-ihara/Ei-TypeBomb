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
                className={`px-4 max-w-${size == "medium" ? "md" : size == "large" ? "2xl" : "xs"} w-full ${className}`}
            >
                {children}
            </div>
        </>
    );
}
