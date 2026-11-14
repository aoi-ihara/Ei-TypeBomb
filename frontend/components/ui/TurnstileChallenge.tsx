"use client";

import { Turnstile } from "@marsidev/react-turnstile";

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
}: TurnstileChallengeProps) => {
    return (
        <>
            <Turnstile
                options={{ language: "ja" }}
                siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
                scriptOptions={{ onError: () => onFail(FAILED_MESSAGE) }}
                onSuccess={onSuccess}
                onError={(errorCode) => onFail(FAILED_MESSAGE, errorCode)}
                onExpire={() =>
                    onFail(
                        "確認の有効期限が切れました。もう一度お試しください。",
                    )
                }
                onTimeout={() =>
                    onFail(
                        "確認がタイムアウトしました。もう一度お試しください。",
                    )
                }
                onUnsupported={() =>
                    onFail(
                        "このブラウザーでは確認できません。別のブラウザーでお試しください。",
                    )
                }
            />
        </>
    );
};
