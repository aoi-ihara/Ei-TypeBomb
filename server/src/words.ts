import fs from "fs";
import type { Word } from "../../shared/types";

export const words: Word[] = JSON.parse(
    fs.readFileSync("src/words/demo.json", "utf8"),
);
