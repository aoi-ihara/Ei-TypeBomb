import TypingView from "@/components/feature/InputView";
import type { TypedRecallItem } from "@/type";
import type {
    LearningMode,
    RecallObservation,
    RecallProgress,
} from "@/lib/playground/memory";

type Props = {
    item: TypedRecallItem;
    currentInput: string | null;
    bombStatus: number;
    hasDuplicatePrompt?: boolean;
    onSuccess: () => void;
    onChangeInput: (input: string) => void;
    enableRemoteTypingSync?: boolean;
    learningMode?: LearningMode;
    initialCueRatio?: number;
    cueSteps?: number[];
    hintDelaysMs?: number[] | null;
    onRecallProgress?: (progress: RecallProgress) => void;
    onRecallComplete?: (observation: RecallObservation) => void;
};

export default function TypedRecallView({
    item,
    currentInput,
    bombStatus,
    hasDuplicatePrompt = false,
    onSuccess,
    onChangeInput,
    enableRemoteTypingSync = true,
    learningMode,
    initialCueRatio,
    cueSteps,
    hintDelaysMs,
    onRecallProgress,
    onRecallComplete,
}: Readonly<Props>) {
    return (
        <TypingView
            hasDuplicateMeaning={hasDuplicatePrompt}
            japanese={item.prompt}
            english={item.answer}
            bombStatus={bombStatus}
            onSuccess={onSuccess}
            onChangeInput={onChangeInput}
            currentInput={currentInput}
            enableRemoteTypingSync={enableRemoteTypingSync}
            learningMode={learningMode}
            initialCueRatio={initialCueRatio}
            cueSteps={cueSteps}
            hintDelaysMs={hintDelaysMs}
            onRecallProgress={onRecallProgress}
            onRecallComplete={onRecallComplete}
        />
    );
}
