"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import posthog from "posthog-js";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";

export default function RoomShareActions({
    link,
    roomId,
}: {
    link: string;
    roomId: string;
}) {
    const [isCopied, setIsCopied] = useState(false);
    const [showQrCode, setShowQrCode] = useState(false);
    const roomUrl = new URL(
        "/" + link,
        process.env.NEXT_PUBLIC_JOIN_LINK!,
    ).toString();

    const handleCopy = async () => {
        await navigator.clipboard.writeText(roomUrl);
        posthog.capture("room_code_copied", { room_id: roomId });
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 3000);
    };

    return (
        <>
            <div className="flex gap-4 w-full">
                <Button
                    onClick={() => setShowQrCode(true)}
                    variant="primary"
                    iconName="qrCode"
                    className="w-full"
                >
                    QRコード
                </Button>
                <Button
                    onClick={handleCopy}
                    variant="primary"
                    iconName={isCopied ? "check" : "copy"}
                    className="w-full"
                >
                    {isCopied ? "コピーしました" : "リンクをコピー"}
                </Button>
            </div>

            <div
                className={`w-full h-full flex justify-center px-8 md:px-16 gap-8 md:gap-16 items-center flex-col fixed top-0 left-0 bg-(--color-background) ${
                    !showQrCode &&
                    "opacity-0 scale-95 blur-md pointer-events-none"
                } z-1000 transition-all overlay duration-(--duration-etb) ease-etb`}
                onClick={() => setShowQrCode(false)}
                inert={!showQrCode}
            >
                <div className="font-extrabold text-cyan-600 text-2xl">
                    Ei-TypeBomb
                </div>
                <div className="w-full bg-(--color-background) gap-8 md:gap-16 flex flex-col lg:flex-row justify-center items-center">
                    <QRCodeSVG
                        value={roomUrl}
                        size={256}
                        fgColor="var(--color-foreground)"
                        bgColor="var(--color-background)"
                        className="text-(--color-foreground) md:shrink-0"
                    />
                    <div className="w-64 lg:w-0.5 h-0.5 lg:h-64 bg-(--color-border) shrink-0"></div>
                    <div className="flex items-center justify-center">
                        <div className="font-bold bg-(--color-background-secondary) px-4 py-2 rounded-lg font-mono text-center tracking-wider leading-normal text-3xl sm:text-4xl">
                            {roomUrl}
                        </div>
                    </div>
                </div>
                <div className="opacity-50">escまたはクリックで戻る。</div>
            </div>
        </>
    );
}
