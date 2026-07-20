"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getSession } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/sign-out";

export default function Home() {
    const [isSelected, setIsSelected] = useState(false); // Whether the play button is selected
    const [showCursor, setShowCursor] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [showPopUp, setShowPopUp] = useState(false);

    const router = useRouter();

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        const fetchUserData = async () => {
            const userId = await getSession();
            if (!userId) return;

            setUserId(userId);
        };

        fetchUserData();

        return () => {
            clearInterval(intervalId);
        };
    }, [router]);

    return (
        <div className="flex flex-col h-dvh w-dvw">
            {showPopUp && (
                <div
                    className="absolute top-0 left-0 w-full h-full"
                    onClick={() => setShowPopUp(false)}
                />
            )}
            <div className="w-full flex justify-end p-2">
                {userId ? (
                    <>
                        <div
                            className="relative rounded-lg"
                            data-cursor="button"
                            data-cursor-shape="1"
                        >
                            <button
                                className="h-8 w-8 flex items-center justify-center font-semibold $ active:scale-95 transition-all duration-200 ease-out"
                                onClick={() => setShowPopUp(!showPopUp)}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    height="20px"
                                    viewBox="0 -960 960 960"
                                    width="20px"
                                    fill="currentColor"
                                >
                                    <path d="M234-276q51-39 114-61.5T480-360q69 0 132 22.5T726-276q35-41 54.5-93T800-480q0-133-93.5-226.5T480-800q-133 0-226.5 93.5T160-480q0 59 19.5 111t54.5 93Zm146.5-204.5Q340-521 340-580t40.5-99.5Q421-720 480-720t99.5 40.5Q620-639 620-580t-40.5 99.5Q539-440 480-440t-99.5-40.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z" />
                                </svg>
                            </button>

                            <div
                                className={`absolute top-10 w-48 p-1 right-0 ${showPopUp ? "" : "opacity-0 pointer-events-none"} transition-all duration-200 ease-out`}
                            >
                                <div
                                    className={`${!showPopUp && "scale-x-20 translate-x-21 -translate-y-16 scale-y-25"} transition-all duration-200 ease-out`}
                                >
                                    <div
                                        className="rounded-sm w-full"
                                        data-cursor={showPopUp && "button"}
                                        data-cursor-shape="1"
                                    >
                                        <button
                                            className="flex w-full h-8 items-center px-2 font-semibold rounded-lg active:scale-95 transition-all duration-200 ease-out"
                                            onClick={() =>
                                                router.push("/my-rooms")
                                            }
                                        >
                                            My Rooms
                                        </button>
                                    </div>
                                    <div
                                        className="rounded-sm"
                                        data-cursor={showPopUp && "button"}
                                        data-cursor-shape="1"
                                    >
                                        <button
                                            className="flex w-full h-8 items-center px-2 font-semibold rounded-lg active:scale-95 transition-all duration-200 ease-out"
                                            onClick={() => {
                                                signOut();
                                                setUserId(null);
                                            }}
                                        >
                                            Sign Out
                                        </button>
                                    </div>
                                </div>
                                <div
                                    className={`absolute right-0 ${showPopUp ? "w-48 top-0  h-full" : "w-8 -top-10 h-8"} rounded-lg -z-1 transition-all duration-200 ease-out bg-(--color-background-secondary)`}
                                />
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div
                            className="rounded-lg"
                            data-cursor="button"
                            data-cursor-shape="1"
                        >
                            <button
                                className="flex h-8 items-center px-2 font-semibold rounded-lg active:scale-95 transition-all duration-200 ease-out"
                                onClick={() => router.push("/sign-in")}
                            >
                                Sign In
                            </button>
                        </div>
                    </>
                )}
            </div>
            <div className="flex h-full flex-col justify-center items-center gap-16">
                <div className="flex flex-col items-center gap-4 rounded-2xl overflow-clip">
                    <Image
                        src={"/favicon.svg"}
                        alt="page-logo"
                        width={150}
                        height={150}
                    ></Image>
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
                            className={`${isSelected ? "w-6" : "w-0 opacity-0"} transition-all hidden duration-200 ease-out md:flex overflow-hidden`}
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
                            className="mr-1 md:group-hover:rotate-30 transition-transform duration-200 ease-out"
                        >
                            <path d="M19.5,12c0-0.23-0.01-0.45-0.03-0.68l1.86-1.41c0.4-0.3,0.51-0.86,0.26-1.3l-1.87-3.23c-0.25-0.44-0.79-0.62-1.25-0.42 l-2.15,0.91c-0.37-0.26-0.76-0.49-1.17-0.68l-0.29-2.31C14.8,2.38,14.37,2,13.87,2h-3.73C9.63,2,9.2,2.38,9.14,2.88L8.85,5.19 c-0.41,0.19-0.8,0.42-1.17,0.68L5.53,4.96c-0.46-0.2-1-0.02-1.25,0.42L2.41,8.62c-0.25,0.44-0.14,0.99,0.26,1.3l1.86,1.41 C4.51,11.55,4.5,11.77,4.5,12s0.01,0.45,0.03,0.68l-1.86,1.41c-0.4,0.3-0.51,0.86-0.26,1.3l1.87,3.23c0.25,0.44,0.79,0.62,1.25,0.42 l2.15-0.91c0.37,0.26,0.76,0.49,1.17,0.68l0.29,2.31C9.2,21.62,9.63,22,10.13,22h3.73c0.5,0,0.93-0.38,0.99-0.88l0.29-2.31 c0.41-0.19,0.8-0.42,1.17-0.68l2.15,0.91c0.46,0.2,1,0.02,1.25-0.42l1.87-3.23c0.25-0.44,0.14-0.99-0.26-1.3l-1.86-1.41 C19.49,12.45,19.5,12.23,19.5,12z M12.04,15.5c-1.93,0-3.5-1.57-3.5-3.5s1.57-3.5,3.5-3.5s3.5,1.57,3.5,3.5S13.97,15.5,12.04,15.5z" />
                        </svg>
                        Settings
                    </button>
                </div>
            </div>
        </div>
    );
}
