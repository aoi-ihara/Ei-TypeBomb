import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import OfflineClient from "../../app/(game)/[link]/offline/Client";
import SelectionQuestionView from "../../components/recall/SelectionQuestionView";
import type { Room } from "../../type";

const items = ["apple", "banana", "orange", "grape"].map((answer) => ({
  id: answer,
  type: "typed_recall" as const,
  prompt: `question: ${answer}`,
  answer,
}));
const room = {
  id: "shortcut-test",
  title: "Shortcut test",
  items,
  maxPlayers: 4,
} as Room;

// The full offline client exercises scheduling, pause/resume, and real guest
// localStorage history. Only network/server adapters are replaced by the server.
function ControlsFixture() {
  useEffect(() => {
    document.documentElement.dataset.fixtureReady = "true";
    return () => {
      delete document.documentElement.dataset.fixtureReady;
    };
  }, []);
  const [render, rerender] = useState(0);
  const [clicks, setClicks] = useState(0);
  return (
    <>
      <input aria-label="editor" />
      <textarea aria-label="notes" />
      <select aria-label="select">
        <option>one</option>
        <option>two</option>
      </select>
      <div
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="rich editor"
      />
      <button onClick={() => setClicks(clicks + 1)}>Outside {clicks}</button>
      <button onClick={() => rerender(render + 1)}>Rerender {render}</button>
      <SelectionQuestionView
        item={items[0]}
        items={items}
        currentInput={null}
        allowHint={!location.search.includes("online")}
        onAnswer={() => {}}
        onSuccess={() => {}}
      />
    </>
  );
}
const params = new URLSearchParams(location.search);
const card = params.has("card");
const single = card && params.has("single");
const practiceRoom = single ? { ...room, items: items.slice(0, 1) } : room;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.search && !card ? (
      <ControlsFixture />
    ) : (
      <OfflineClient
        room={practiceRoom}
        answerMode={card ? "card" : "selection"}
        initialBackgroundMusic={false}
        initialSounDeffects={false}
      />
    )}
  </StrictMode>,
);
