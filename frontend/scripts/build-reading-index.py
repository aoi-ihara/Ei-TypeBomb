"""Build from mecab-ipadic at taku910/mecab commit 61b90ba6e669dc2d7d533d4a80d206f3b31d52b1.
Usage: python3 scripts/build-reading-index.py /path/to/mecab-ipadic
"""
import csv
import gzip
import re
import shutil
import sys
from pathlib import Path

source = Path(sys.argv[1])
target = Path(__file__).resolve().parents[1] / "lib/room/ipadic"
index = {}
for file in sorted(source.glob("*.csv")):
    for row in csv.reader(file.open(encoding="euc_jp")):
        word, cost, kana = row[0], int(row[3]), row[-2]
        if row[5] == "固有名詞":
            continue
        if not re.search(r"[㐀-鿿々]", word) or not re.fullmatch(r"[ァ-ヶー]+", kana):
            continue
        reading = "".join(chr(ord(c) - 96) if c != "ー" else c for c in kana)
        candidates = index.setdefault(word, {})
        candidates[reading] = min(cost, candidates.get(reading, cost))

lines = ["\t".join([word, *sorted(readings, key=readings.get)[:8]])
         for word, readings in sorted(index.items())]
(target / "readings.tsv.gz").write_bytes(gzip.compress("\n".join(lines).encode(), mtime=0))
shutil.copyfile(source / "COPYING", target / "COPYING")
