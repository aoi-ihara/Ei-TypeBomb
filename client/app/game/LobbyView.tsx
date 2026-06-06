import { GameState } from "@/types";

export default function LobbyView({ gameState }: { gameState: GameState }) {
    return (
        <div>
            <div className="w-fit text-2xl font-bold font-mono px-2 py-1">
                Connected
            </div>
        </div>
    );
}
