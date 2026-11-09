import "@/app/page.css";

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { MarkdownReader } from "@/components/docs/MarkdownReader";

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
