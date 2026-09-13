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
let patched = source;

if (!patched.includes("const restrictWordDrag:")) {
    const importTarget = `    DndContext,\n    PointerSensor,`;
    const importReplacement = `    DndContext,\n    PointerSensor,\n    type Modifier,`;

    const sensorTarget = `    const sensors = useSensors(useSensor(PointerSensor));`;
    const sensorReplacement = `    const wordListRef = useRef<HTMLDivElement | null>(null);\n\n    const restrictWordDrag: Modifier = ({ transform, activeNodeRect }) => {\n        const list = wordListRef.current;\n\n        if (!list || !activeNodeRect) {\n            return { ...transform, x: 0 };\n        }\n\n        const rect = list.getBoundingClientRect();\n        const minY = rect.top - activeNodeRect.top;\n        const maxY = rect.bottom - activeNodeRect.bottom;\n\n        return {\n            ...transform,\n            x: 0,\n            y: Math.min(Math.max(transform.y, minY), maxY),\n        };\n    };\n\n    const sensors = useSensors(useSensor(PointerSensor));`;

    const contextTarget = `                    <div className="flex flex-col gap-4">\n                        <DndContext\n                            sensors={sensors}\n                            collisionDetection={closestCenter}\n                            onDragEnd={handleDragEnd}\n                        >`;
    const contextReplacement = `                    <div ref={wordListRef} className="flex flex-col gap-4">\n                        <DndContext\n                            sensors={sensors}\n                            modifiers={[restrictWordDrag]}\n                            collisionDetection={closestCenter}\n                            onDragEnd={handleDragEnd}\n                        >`;

    const replacements = [
        [importTarget, importReplacement],
        [sensorTarget, sensorReplacement],
        [contextTarget, contextReplacement],
    ];

    for (const [target, replacement] of replacements) {
        if (!patched.includes(target)) {
            throw new Error(`Expected source pattern was not found: ${target}`);
        }
        patched = patched.replace(target, replacement);
    }
}

if (!patched.includes("const maxSaveTimerRef = useRef<NodeJS.Timeout | null>(null);")) {
    const saveTimerTarget = `    const saveTimerRef = useRef<NodeJS.Timeout | null>(null);`;
    const saveTimerReplacement = `    const saveTimerRef = useRef<NodeJS.Timeout | null>(null);\n    const maxSaveTimerRef = useRef<NodeJS.Timeout | null>(null);`;

    const autoSaveEffectTarget = `    useEffect(() => {\n        if (!isLoadedRef.current || !roomId || words === null) return;\n\n        if (saveTimerRef.current) {\n            clearTimeout(saveTimerRef.current);\n        }\n\n        saveTimerRef.current = setTimeout(() => {\n            saveRoomData();\n        }, 2000);\n    }, [roomTitle, roomExplanation, maxPlayers, words, roomId, roomLink]);`;

    const autoSaveEffectReplacement = `    useEffect(() => {\n        if (!isLoadedRef.current || !roomId || words === null) return;\n\n        if (saveTimerRef.current) {\n            clearTimeout(saveTimerRef.current);\n        }\n\n        saveTimerRef.current = setTimeout(() => {\n            if (maxSaveTimerRef.current) {\n                clearTimeout(maxSaveTimerRef.current);\n                maxSaveTimerRef.current = null;\n            }\n            saveRoomData();\n        }, 1000);\n\n        if (!maxSaveTimerRef.current) {\n            maxSaveTimerRef.current = setTimeout(() => {\n                if (saveTimerRef.current) {\n                    clearTimeout(saveTimerRef.current);\n                    saveTimerRef.current = null;\n                }\n                maxSaveTimerRef.current = null;\n                saveRoomData();\n            }, 8000);\n        }\n    }, [roomTitle, roomExplanation, maxPlayers, words, roomId, roomLink]);\n\n    useEffect(() => {\n        return () => {\n            if (saveTimerRef.current) {\n                clearTimeout(saveTimerRef.current);\n            }\n            if (maxSaveTimerRef.current) {\n                clearTimeout(maxSaveTimerRef.current);\n            }\n        };\n    }, []);`;

    if (!patched.includes(saveTimerTarget)) {
        throw new Error(`Expected save timer declaration was not found: ${saveTimerTarget}`);
    }
    if (!patched.includes(autoSaveEffectTarget)) {
        throw new Error("Expected auto-save effect was not found");
    }

    patched = patched.replace(saveTimerTarget, saveTimerReplacement);
    patched = patched.replace(autoSaveEffectTarget, autoSaveEffectReplacement);
}

if (patched !== source) {
    fs.writeFileSync(filePath, patched, "utf8");
}
