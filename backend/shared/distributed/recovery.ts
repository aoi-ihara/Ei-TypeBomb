/** Public recovery failures contain no credentials, peer proofs or room state.
 * Classify by message too: peer/DO RPC transports may recreate Error objects. */
export function recoveryFailure(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    switch (message) {
        case "No existing room to restore":
        case "Expected checkpoint is unavailable":
            return {
                code: "CHECKPOINT_UNAVAILABLE",
                retryable: false,
                message:
                    "以前の対戦のチェックポイントを取得できません。保存済みのサーバーを復旧してから再接続してください。",
            };
        case "Ineligible voter or lost process memory":
        case "Voter incarnation changed":
        case "Voter lost state; cannot vote":
            return {
                code: "VOTER_STATE_LOST",
                retryable: false,
                message:
                    "このサーバーには以前の対戦を安全に引き継ぐ投票状態がありません。元のサーバーまたは永続ディスクを復旧してから再接続してください。",
            };
        case "Server is not in the room voting cohort":
            return {
                code: "VOTER_NOT_IN_COHORT",
                retryable: false,
                message:
                    "このサーバーは以前の対戦の引き継ぎ先に含まれていません。投票資格のあるサーバーを復旧してから再接続してください。",
            };
        default:
            return undefined;
    }
}

/** An authenticated routing request may fail without making the room unusable.
 * Expose only specific, known safe reasons as machine-readable diagnostics. */
export function transientRecoveryFailure(error: unknown) {
    if (error instanceof Error && error.message === "Owner has not approved transfer")
        return { code: "OWNER_TRANSFER_NOT_APPROVED", retryable: true };
    return undefined;
}
