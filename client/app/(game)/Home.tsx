"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getSession } from "@/lib/auth/session";
import { signOut } from "@/lib/auth/sign-out";
import posthog from "posthog-js";
import { Icon } from "@/components/ui/Icon";

export default function Home() {
    const [showCursor, setShowCursor] = useState(true);
    const [isSelected, setIsSelected] = useState(false); // Whether the play button is selected
    const [showPopUp, setShowPopUp] = useState(false);

    const router = useRouter();

    useEffect(() => {
        const fetchUserData = async () => {
            const userId = await getSession();
            if (!userId) return;

            posthog.identify(userId);
        };

        fetchUserData();
    }, [router]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => {
            clearInterval(intervalId);
        };
    });

    return (
        <div className="flex flex-col h-dvh w-dvw">
            {showPopUp && (
                <div
                    className="absolute top-0 left-0 w-full h-full"
                    onClick={() => setShowPopUp(false)}
                />
            )}
            <div className="w-full flex justify-end p-2">
                {true ? (
                    <>
                        <div
                            className="relative rounded-lg"
                            data-cursor="button"
                            data-cursor-shape="1"
                        >
                            <button
                                className="h-8 w-8 flex items-center justify-center font-semibold $ active:scale-95 transition-all cursor-pointer duration-400 ease-[linear(0,0.009_0.7%,0.038_1.5%,0.145_3.1%,0.763_9.1%,0.99_11.8%,1.13_14.4%,1.17_15.7%,1.194_17.1%,1.2_18.7%,1.186_20.5%,1.01_29.6%,0.977_32.4%,0.961_35.3%,0.963_38.9%,0.997_47.8%,1.008_53.3%,0.999_71.2%,1)]"
                                onClick={() => setShowPopUp(!showPopUp)}
                            >
                                <Icon name="circleUserRound" />
                            </button>

                            <div
                                className={`absolute top-10 w-48 p-1 right-0 ${showPopUp ? "" : "opacity-0 pointer-events-none"} transition-all duration-400 ease-[linear(0,0.008_1.4%,0.032_2.8%,0.13_6%,0.259_9%,0.668_17.6%,0.87_22.8%,0.945_25.3%,1.004_27.8%,1.051_30.4%,1.084_33%,1.112_37.4%,1.112_42.5%,1.019_61.7%,0.991_72.3%,0.987_81.8%,1)]`}
                            >
                                <div
                                    className={`${!showPopUp && "scale-x-20 translate-x-21 -translate-y-16 scale-y-25"} transition-all duration-400 ease-[linear(0,0.008_1.4%,0.032_2.8%,0.13_6%,0.259_9%,0.668_17.6%,0.87_22.8%,0.945_25.3%,1.004_27.8%,1.051_30.4%,1.084_33%,1.112_37.4%,1.112_42.5%,1.019_61.7%,0.991_72.3%,0.987_81.8%,1)]`}
                                >
                                    <div
                                        className="rounded-sm w-full"
                                        data-cursor={showPopUp && "button"}
                                        data-cursor-shape="1"
                                    >
                                        <button
                                            className="flex cursor-pointer w-full h-8 items-center px-2 font-semibold rounded-lg active:scale-95 transition-all duration-200 ease-out"
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
                                            className="flex cursor-pointer w-full h-8 items-center px-2 font-semibold rounded-lg active:scale-95 transition-all duration-200 ease-out"
                                            onClick={() => {
                                                posthog.capture("signed_out");
                                                posthog.reset();
                                                signOut();
                                            }}
                                        >
                                            Sign Out
                                        </button>
                                    </div>
                                </div>
                                <div
                                    className={`absolute right-0 ${showPopUp ? "w-48 top-0  h-full" : "w-8 -top-10 h-8"} rounded-lg -z-1 transition-all duration-400 ease-[linear(0,0.008_1.4%,0.032_2.8%,0.13_6%,0.259_9%,0.668_17.6%,0.87_22.8%,0.945_25.3%,1.004_27.8%,1.051_30.4%,1.084_33%,1.112_37.4%,1.112_42.5%,1.019_61.7%,0.991_72.3%,0.987_81.8%,1)] bg-(--color-background-secondary)`}
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
                                className="flex h-8 items-center px-2 font-semibold cursor-pointer rounded-lg active:scale-95 transition-all duration-200 ease-out"
                                onClick={() =>
                                    router.push(
                                        process.env.NEXT_PUBLIC_SIGN_IN_URL!,
                                    )
                                }
                            >
                                Sign In
                            </button>
                        </div>
                    </>
                )}
            </div>
            <div className="flex h-full flex-col justify-center items-center gap-4">
                <div className="items-center mb-12 rounded-2xl overflow-clip">
                    <Image
                        src={showCursor ? "/favicon.svg" : "/favicon-2.svg"}
                        alt="page-logo"
                        width={150}
                        height={150}
                    />
                </div>

                <div
                    className="rounded-lg w-64 flex"
                    data-cursor="button"
                    data-cursor-shape="0"
                >
                    <button
                        data-cursor="button"
                        className="text-lg cursor-pointer items-center font-bold bg-cyan-600 w-full justify-center py-3 rounded-lg text-white flex transition-all duration-200 ease-out active:scale-95"
                        data-cursor-shape="0"
                        onMouseEnter={() => {
                            setIsSelected(true);
                        }}
                        onMouseLeave={() => {
                            setIsSelected(false);
                        }}
                        onClick={() => router.push("/room")}
                    >
                        <div
                            className={`${isSelected ? "w-8" : "w-0 opacity-0"} transition-all hidden duration-200 ease-out md:flex overflow-hidden`}
                        >
                            <Icon name="play" size={24} />
                        </div>
                        <div className="mr-1">Play</div>
                    </button>
                </div>

                <div
                    className="rounded-lg flex"
                    data-cursor="button"
                    data-cursor-shape="1"
                >
                    <button
                        data-cursor="button"
                        className="group cursor-pointer justify-center pr-2 pl-1 w-full flex items-center py-1 gap-1 text-cyan-600 rounded-lg font-bold transition-transform duration-200 ease-out active:scale-95 z-1000"
                        data-cursor-shape="1"
                        onClick={() => router.push("/settings")}
                    >
                        <Icon name="settings" />
                        Settings
                    </button>
                </div>
            </div>
        </div>
    );
}
