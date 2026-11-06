"use client";

import ReactMarkdown from "react-markdown";
import Button from "@/components/ui/Button";
import Header from "@/components/layout/Header";
import Shell from "@/components/layout/Shell";

export function MarkdownReader({
    title,
    content,
}: {
    title: string;
    content: string;
}) {
    return (
        <>
            <Header />
            <Shell
                title={title}
                size="large"
                className="flex flex-col px-4 gap-8"
            >
                <div className="block">
                    <ReactMarkdown
                        components={{
                            h2: ({ children }) => (
                                <h2
                                    className="font-bold font-mono text-xl my-8"
                                    data-cursor="text"
                                >
                                    {children}
                                </h2>
                            ),
                            h3: ({ children }) => (
                                <h3
                                    className="font-bold font-mono my-8"
                                    data-cursor="text"
                                >
                                    {children}
                                </h3>
                            ),
                            p: ({ children }) => (
                                <div className="mb-2" data-cursor="text">
                                    {children}
                                </div>
                            ),
                            ol: ({ children }) => (
                                <ol
                                    className="list-decimal list-outside ml-6 my-2 flex flex-col gap-2"
                                    data-cursor="text"
                                >
                                    {children}
                                </ol>
                            ),
                            ul: ({ children }) => (
                                <ul
                                    className="list-disc list-outside ml-6 my-2 flex flex-col gap-2"
                                    data-cursor="text"
                                >
                                    {children}
                                </ul>
                            ),
                            li: ({ children }) => (
                                <li
                                    className="text-gray-800 dark:text-gray-200"
                                    data-cursor="text"
                                >
                                    {children}
                                </li>
                            ),
                            a: ({ href, children }) => (
                                <Button
                                    iconName="squareArrowOutUpRight"
                                    variant="text"
                                    href={href}
                                >
                                    {children}
                                </Button>
                            ),
                        }}
                    >
                        {content}
                    </ReactMarkdown>
                </div>
            </Shell>
        </>
    );
}
