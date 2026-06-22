#!/usr/bin/env python3
"""
Dataset generation script for TypeAhead Search System.
Uses the `wordfreq` package to generate 150k+ English words with frequency counts.

Install: pip install wordfreq --break-system-packages
Usage:   python scripts/generate-dataset.py
Output:  data/dataset.csv (query, count)
"""

import csv
import os
from wordfreq import top_n_list, word_frequency

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
OUTPUT_FILE = os.path.join(OUTPUT_DIR, 'dataset.csv')
NUM_WORDS = 150_000
MULTIPLIER = 1_000_000_000  # Scale frequencies to integer counts


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Fetching top {NUM_WORDS:,} English words...")
    words = top_n_list('en', NUM_WORDS)
    print(f"Got {len(words):,} words. Generating counts...")

    rows = []
    skipped = 0
    for w in words:
        freq = word_frequency(w, 'en')
        count = round(freq * MULTIPLIER)
        if count < 1:
            skipped += 1
            continue
        rows.append((w, count))

    print(f"Writing {len(rows):,} rows to {OUTPUT_FILE} (skipped {skipped} with zero count)...")

    with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['query', 'count'])
        for query, count in rows:
            writer.writerow([query, count])

    print(f"Done! Dataset written to {OUTPUT_FILE}")
    print(f"Total rows: {len(rows):,}")


if __name__ == '__main__':
    main()
