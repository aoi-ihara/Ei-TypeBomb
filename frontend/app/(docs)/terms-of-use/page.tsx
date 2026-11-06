import Header from "@/components/layout/Header";
import Shell from "@/components/layout/Shell";
import "@/app/page.css";

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import ReactMarkdown from "react-markdown";
import Button from "@/components/ui/Button";
import { MarkdownReader } from "@/components/layout/MarkdownReader";

export default async function TermsOfUsePage() {
    const filePath = path.join(
        process.cwd(),
        "content",
        "law",
        "terms-of-use.md",
    );

    const fileContents = fs.readFileSync(filePath, "utf8");

    const { content } = matter(fileContents);

    return <MarkdownReader title="利用規約" content={content} />;
}
