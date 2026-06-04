"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
    const [isSelected, setIsSelected] = useState(false); // Whether the play button is selected
    const [showCursor, setShowCursor] = useState(false);

    const router = useRouter();

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => {
            clearInterval(intervalId);
        };
    }, [router]);

    return (
        <div className="flex flex-col justify-center h-dvh items-center gap-16">
            <div className="flex items-end">
                <h1 className="font-mono font-bold text-2xl" data-cursor="text">
                    Ei Typing
                </h1>
                <div
                    className={`w-3 h-1 mb-1 ml-1 bg-cyan-600 ${!showCursor && "opacity-0"}`}
                />
            </div>

            <div
                className="rounded-lg w-48 flex"
                data-cursor="button"
                data-cursor-shape="0"
            >
                <button
                    data-cursor="button"
                    className="text-lg items-center font-bold bg-cyan-600 w-full justify-center py-2 rounded-lg text-white flex transition-all duration-200 ease-out active:scale-95"
                    data-cursor-shape="0"
                    onMouseEnter={() => {
                        setIsSelected(true);
                    }}
                    onMouseLeave={() => {
                        setIsSelected(false);
                    }}
                    onClick={() => router.push("/display-name")}
                >
                    <div
                        className={`${isSelected ? "w-6" : "w-0 opacity-0"} transition-all duration-200 ease-out flex overflow-hidden`}
                    >
                        ▶
                    </div>
                    <div className="mr-1">Play</div>
                </button>
            </div>

            <div
                className="rounded-lg w-fit flex"
                data-cursor="button"
                data-cursor-shape="1"
            >
                <button
                    data-cursor="button"
                    className="group w-full justify-center pr-2 pl-1.5 flex items-center py-1 text-cyan-600 rounded-md font-bold transition-transform duration-200 ease-out active:scale-95 z-1000"
                    data-cursor-shape="1"
                    onClick={() => router.push("/settings")}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        enableBackground="new 0 0 24 24"
                        height="20px"
                        viewBox="0 0 24 24"
                        width="20px"
                        fill="currentColor"
                        className="mr-1 group-hover:rotate-30 transition-transform duration-200 ease-out"
                    >
                        <path d="M19.5,12c0-0.23-0.01-0.45-0.03-0.68l1.86-1.41c0.4-0.3,0.51-0.86,0.26-1.3l-1.87-3.23c-0.25-0.44-0.79-0.62-1.25-0.42 l-2.15,0.91c-0.37-0.26-0.76-0.49-1.17-0.68l-0.29-2.31C14.8,2.38,14.37,2,13.87,2h-3.73C9.63,2,9.2,2.38,9.14,2.88L8.85,5.19 c-0.41,0.19-0.8,0.42-1.17,0.68L5.53,4.96c-0.46-0.2-1-0.02-1.25,0.42L2.41,8.62c-0.25,0.44-0.14,0.99,0.26,1.3l1.86,1.41 C4.51,11.55,4.5,11.77,4.5,12s0.01,0.45,0.03,0.68l-1.86,1.41c-0.4,0.3-0.51,0.86-0.26,1.3l1.87,3.23c0.25,0.44,0.79,0.62,1.25,0.42 l2.15-0.91c0.37,0.26,0.76,0.49,1.17,0.68l0.29,2.31C9.2,21.62,9.63,22,10.13,22h3.73c0.5,0,0.93-0.38,0.99-0.88l0.29-2.31 c0.41-0.19,0.8-0.42,1.17-0.68l2.15,0.91c0.46,0.2,1,0.02,1.25-0.42l1.87-3.23c0.25-0.44,0.14-0.99-0.26-1.3l-1.86-1.41 C19.49,12.45,19.5,12.23,19.5,12z M12.04,15.5c-1.93,0-3.5-1.57-3.5-3.5s1.57-3.5,3.5-3.5s3.5,1.57,3.5,3.5S13.97,15.5,12.04,15.5z" />
                    </svg>
                    Settings
                </button>
            </div>
        </div>
    );
}
