const fs = require("node:fs");
const path = require("node:path");

const filePath = path.join(
    __dirname,
    "..",
    "app",
    "(editor)",
    "my-rooms",
    "[slug]",
    "page.tsx",
);

const source = fs.readFileSync(filePath, "utf8");

if (source.includes("const restrictWordDrag:")) {
    process.exit(0);
}

const importTarget = `    DndContext,\n    PointerSensor,`;
const importReplacement = `    DndContext,\n    PointerSensor,\n    type Modifier,`;

const modifierTarget = `function SortableItem({`;
const modifierReplacement = `const restrictWordDrag: Modifier = ({ transform, activeNodeRect }) => {\n    const list = wordListRef.current;\n\n    if (!list || !activeNodeRect) {\n        return { ...transform, x: 0 };\n    }\n\n    const rect = list.getBoundingClientRect();\n    const minY = rect.top - activeNodeRect.top;\n    const maxY = rect.bottom - activeNodeRect.bottom;\n\n    return {\n        ...transform,\n        x: 0,\n        y: Math.min(Math.max(transform.y, minY), maxY),\n    };\n};\n\nfunction SortableItem({`;

const sensorTarget = `    const sensors = useSensors(useSensor(PointerSensor));`;
const sensorReplacement = `    const wordListRef = useRef<HTMLDivElement | null>(null);\n    const sensors = useSensors(useSensor(PointerSensor));`;

const contextTarget = `                    <div className="flex flex-col gap-4">\n                        <DndContext\n                            sensors={sensors}\n                            collisionDetection={closestCenter}\n                            onDragEnd={handleDragEnd}\n                        >`;
const contextReplacement = `                    <div ref={wordListRef} className="flex flex-col gap-4">\n                        <DndContext\n                            sensors={sensors}\n                            modifiers={[restrictWordDrag]}\n                            collisionDetection={closestCenter}\n                            onDragEnd={handleDragEnd}\n                        >`;

const replacements = [
    [importTarget, importReplacement],
    [modifierTarget, modifierReplacement],
    [sensorTarget, sensorReplacement],
    [contextTarget, contextReplacement],
];

let patched = source;

for (const [target, replacement] of replacements) {
    if (!patched.includes(target)) {
        throw new Error(`Expected source pattern was not found: ${target}`);
    }
    patched = patched.replace(target, replacement);
}

fs.writeFileSync(filePath, patched, "utf8");
