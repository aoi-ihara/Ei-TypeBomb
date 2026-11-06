import Header from "@/components/layout/Header";
import Shell from "@/components/layout/Shell";
import "@/app/page.css";

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { marked } from "marked";

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
            <div data-cursor="text">{children}</div>
        </div>
    );
}

export default async function TermsOfUsePage() {
    const filePath = path.join(
        process.cwd(),
        "content",
        "law",
        "terms-of-use.md",
    );

    const fileContents = fs.readFileSync(filePath, "utf8");

    const { data, content } = matter(fileContents);

    const htmlContent = await marked(content);

    return (
        <>
            <Header />
            <Shell
                title={data.title || "利用規約"}
                size="large"
                className="flex flex-col px-4 gap-8"
            >
                <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
            </Shell>
        </>
    );
}
