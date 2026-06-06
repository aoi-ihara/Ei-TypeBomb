"use client";

import { User, Word, GameState, JoinRequest } from "@/types";
import { Events } from "@/events";
import { io, Socket } from "socket.io-client";
import { DEFAULT_SERVER_URL } from "@/constants/config";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { stringifyCookie } from "next/dist/compiled/@edge-runtime/cookies";
import UsersView from "@/components/feature/UsersView";
import TypingView from "@/components/feature/InputView";

export default function Client() {
    const router = useRouter();
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [myUser, setMyUser] = useState<User | null>();

    const socketRef = useRef<Socket | null>(null);

    const setverUrl =
        typeof window !== "undefined"
            ? (localStorage.getItem("server-url") ?? DEFAULT_SERVER_URL)
            : DEFAULT_SERVER_URL;

    useEffect(() => {
        const socket = io(setverUrl);

        socketRef.current = socket;

        socket.on("connect", () => {
            console.log("connected:", socket.id);
            setMyUser({ displayName: "vgnz93hs", userId: socket.id as string });
        });

        socket.on(Events.ROOM_STATE, (data: GameState) => {
            setGameState(data);
            console.log("Room Info", data);
        });
    }, [router]);

    useEffect(() => {
        if (!socketRef.current) return;
        socketRef.current.emit(Events.ROOM_WATCH);
    }, [router]);

    return (
        <>
            <div className="flex flex-col md:flex-row w-full h-full">
                <div
                    className={`max-w-2xl md:order-2 w-full px-4 gap-4 pb-4 pt-4 h-full justify-end flex flex-col`}
                >
                    <div
                        className={`flex flex-col bg-(--color-background-secondary) transition-all duration-200 ease-[cubic-bezier(0.1,0.5,0,1)] ${"h-full"} rounded-2xl p-2 w-full`}
                    ></div>
                </div>

                <div className="w-full flex md:order-1">
                    <div>UserView</div>
                </div>
            </div>
        </>
    );
}
