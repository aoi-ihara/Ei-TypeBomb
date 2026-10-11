"use client";

import { useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import Button from "./Button";

const FAILED_MESSAGE =
    "ロボットではないことの確認に失敗しました。もう一度お試しください。";

type TurnstileChallengeProps = {
    onSuccess: (turnstileToken: string) => void;
    onFail: (reason: string, errorCode?: string) => void;
    onCancel: () => void;
};

export const TurnstileChallenge = ({
    onSuccess,
    onFail,
    onCancel,
}: TurnstileChallengeProps) => {
    const [widgetLoaded, setWidgetLoaded] = useState(false);

    return (
        <>
            {!widgetLoaded && (
                <a className="gradient-text font-bold" data-cursor="text">
                    読み込み中…
                </a>
            )}
            <Turnstile
                options={{ language: "ja" }}
                siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
                scriptOptions={{ onError: () => onFail(FAILED_MESSAGE) }}
                onWidgetLoad={() => setWidgetLoaded(true)}
                onSuccess={onSuccess}
                onError={(errorCode) => onFail(FAILED_MESSAGE, errorCode)}
                onExpire={() =>
                    onFail("確認の有効期限が切れました。もう一度お試しください。")
                }
                onTimeout={() =>
                    onFail("確認がタイムアウトしました。もう一度お試しください。")
                }
                onUnsupported={() =>
                    onFail(
                        "このブラウザーでは確認できません。別のブラウザーでお試しください。",
                    )
                }
            />
            <Button onClick={onCancel} variant="text">
                キャンセル
            </Button>
        </>
    );
};
