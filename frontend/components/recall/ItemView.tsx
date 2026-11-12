import TypedRecallView from "@/components/recall/TypedRecallView";
import SelectionQuestionView from "@/components/recall/SelectionQuestionView";
import {
    resolveQuestionPresentation,
    type AnswerMode,
} from "@/lib/answer-mode";
import type { Item } from "@/type";
import type {
    LearningMode,
    RecallObservation,
    RecallProgress,
} from "@/lib/playground/memory";

type Props = {
    item: Item;
    currentInput: string | null;
    bombStatus: number;
    hasDuplicatePrompt?: boolean;
    onSuccess: () => void;
    onChangeInput: (input: string, failed?: boolean) => void;
    enableRemoteTypingSync?: boolean;
    remoteHintLength?: number;
    onHintChange?: (length: number) => void;
    learningMode?: LearningMode;
    initialCueRatio?: number;
    cueSteps?: number[];
    hintDelaysMs?: number[] | null;
    onRecallProgress?: (progress: RecallProgress) => void;
    onRecallComplete?: (observation: RecallObservation) => void;
    isPaused?: boolean;
    items: Item[];
    answerMode: AnswerMode;
    answerModeMemory?: import("@/lib/playground/memory").ItemMemoryState;
    onSelectionAnswer?: (correct: boolean) => void;
};

export default function ItemView(props: Readonly<Props>) {
    switch (props.item.type) {
        case "typed_recall": {
            const presentation = resolveQuestionPresentation(
                props.answerMode,
                props.item,
                props.answerModeMemory,
            );
            if (presentation === "selection") {
                return (
                    <SelectionQuestionView
                        item={props.item}
                        items={props.items}
                        currentInput={props.currentInput}
                        onAnswer={(correct) =>
                            props.onSelectionAnswer?.(correct)
                        }
                        onSuccess={props.onSuccess}
                        isPaused={props.isPaused}
                    />
                );
            }
            return (
                <TypedRecallView
                    item={props.item}
                    currentInput={props.currentInput}
                    bombStatus={props.bombStatus}
                    hasDuplicatePrompt={props.hasDuplicatePrompt}
                    onSuccess={props.onSuccess}
                    onChangeInput={props.onChangeInput}
                    enableRemoteTypingSync={props.enableRemoteTypingSync}
                    remoteHintLength={props.remoteHintLength}
                    onHintChange={props.onHintChange}
                    learningMode={props.learningMode}
                    initialCueRatio={props.initialCueRatio}
                    cueSteps={props.cueSteps}
                    hintDelaysMs={props.hintDelaysMs}
                    onRecallProgress={props.onRecallProgress}
                    onRecallComplete={props.onRecallComplete}
                    isPaused={props.isPaused}
                />
            );
        }
    }
}
