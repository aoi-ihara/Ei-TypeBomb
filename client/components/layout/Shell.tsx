type AuthShellProps = {
    title: string;
    children: React.ReactNode;
    className?: string;
};

export function AuthShell({
    title,
    children,
    className = "flex flex-col gap-4 items-center",
}: AuthShellProps) {
    return (
        <>
            <h1
                className="w-full text-2xl mt-16 mb-8 font-bold font-mono text-center"
                data-cursor="text"
            >
                {title}
            </h1>
            <div className={`max-w-md w-full ${className}`}>{children}</div>
        </>
    );
}
