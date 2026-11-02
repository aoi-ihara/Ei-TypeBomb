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
                    padding="large"
                    iconName="qrCode"
                    className="w-full"
                >
                    QRコード
                </Button>
                <Button
                    onClick={handleCopy}
                    variant="primary"
                    padding="large"
                    iconName={isCopied ? "check" : "copy"}
                    className="w-full"
                >
                    {isCopied ? "コピーしました" : "リンクをコピー"}
                </Button>
            </div>

            <Dialog
                open={showQrCode}
                onClose={() => setShowQrCode(false)}
                title="ルームのQRコード"
                alignment="vertical"
            >
                <div className="flex flex-col items-center gap-6">
                    <QRCodeSVG
                        value={roomUrl}
                        size={256}
                        fgColor="var(--color-foreground)"
                        bgColor="var(--color-background)"
                        className="text-(--color-foreground)"
                    />
                    <div className="font-bold bg-(--color-background-secondary) px-4 py-2 rounded-lg font-mono text-center tracking-wider leading-normal text-3xl sm:text-4xl wrap-anywhere">
                        {link}
                    </div>
                    <Button
                        onClick={() => setShowQrCode(false)}
                        iconName="check"
                        variant="primary"
                        className="w-full"
                    >
                        閉じる
                    </Button>
                </div>
            </Dialog>
        </>
    );
}
