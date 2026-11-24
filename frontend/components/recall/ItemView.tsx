import TypedRecallView from "@/components/recall/TypedRecallView";
import SelectionQuestionView from "@/components/recall/SelectionQuestionView";
import Card from "@/components/recall/Card";
import { getEffectiveAnswerMode, getTypingAnswer, type OfflineAnswerMode } from "@/lib/answer-mode";
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
    allowSelectionHint?: boolean;
    items: Item[];
    answerMode: OfflineAnswerMode;
    onSelectionAnswer?: (
        correct: boolean,
        hadMistake: boolean,
        responseMs: number | null,
        usedHint?: boolean,
    ) => void;
};

export default function ItemView(props: Readonly<Props>) {
    switch (props.item.type) {
        case "typed_recall": {
            if (props.answerMode === "card") {
                return (
                    <Card
                        item={props.item}
                        currentInput={props.currentInput}
                        isPaused={props.isPaused}
                        onAnswer={(correct, hadMistake, responseMs, usedHint) =>
                            props.onSelectionAnswer?.(correct, hadMistake, responseMs, usedHint)
                        }
                        onSuccess={props.onSuccess}
                    />
                );
            }
            const typingAnswer =
                getEffectiveAnswerMode(props.item, props.answerMode) === "input"
                    ? getTypingAnswer(props.item)
                    : null;
            if (typingAnswer === null) {
                return (
                    <SelectionQuestionView
                        item={props.item}
                        items={props.items}
                        currentInput={props.currentInput}
                        onAnswer={(correct, hadMistake, responseMs, usedHint) =>
                            props.onSelectionAnswer?.(
                                correct,
                                hadMistake,
                                responseMs,
                                usedHint,
                            )
                        }
                        onSuccess={props.onSuccess}
                        isPaused={props.isPaused}
                        allowHint={props.allowSelectionHint}
                    />
                );
            }
            return (
                <TypedRecallView
                    typingAnswer={typingAnswer}
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
