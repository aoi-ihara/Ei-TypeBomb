import fs from "fs";
import type { Word } from "../types";

export const words: Word[] = JSON.parse(
    fs.readFileSync("src/words/demo.json", "utf8"),
);
