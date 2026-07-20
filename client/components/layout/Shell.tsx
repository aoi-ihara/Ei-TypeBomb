type AuthShellProps = {
    title: string;
    children: React.ReactNode;
    className?: string;
    size?: "large" | "small" | "medium";
};

export default function Shell({
    title,
    children,
    className = "flex flex-col gap-4 items-center",
    size = "medium",
}: AuthShellProps) {
    return (
        <>
            <h1
                className="w-full text-2xl mt-16 mb-8 font-bold font-mono text-center"
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
