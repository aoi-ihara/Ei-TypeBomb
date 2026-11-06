import Header from "@/components/layout/Header";
import Shell from "@/components/layout/Shell";

function Section({
    heading,
    children,
}: {
    heading: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-8 w-full">
            <span className="font-bold font-mono text-xl" data-cursor="text">
                {heading}
            </span>
            <span data-cursor="text">{children}</span>
        </div>
    );
}

export default function TermsOfUsePage() {
    return (
        <>
            <Header />
            <Shell
                title="利用規約"
                size="large"
                className="flex flex-col px-4 gap-8"
            >
                <Section heading="Hello World">Hello</Section>
            </Shell>
        </>
    );
}
