import { GameState } from "@/types";

export default function LobbyView({ gameState }: { gameState: GameState }) {
    return (
        <div>
            <div className="w-fit h-64 text-2xl font-bold font-mono px-2 py-1">
                Connected
            </div>
            <button>test</button>
        </div>
    );
}
