import TypedRecallView from "@/components/feature/TypedRecallView";
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
    onChangeInput: (input: string) => void;
    enableRemoteTypingSync?: boolean;
    learningMode?: LearningMode;
    initialCueRatio?: number;
    cueSteps?: number[];
    hintDelaysMs?: number[] | null;
    onRecallProgress?: (progress: RecallProgress) => void;
    onRecallComplete?: (observation: RecallObservation) => void;
};

export default function ItemView(props: Readonly<Props>) {
    switch (props.item.type) {
        case "typed_recall":
            return <TypedRecallView {...props} item={props.item} />;
    }
}
