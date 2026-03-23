#!/usr/bin/env python3
"""
Chat Splitter — Separates human rants from AI responses in exported chat logs.

Usage:
  python3 chat-splitter.py <input_file>
  python3 chat-splitter.py <input_file> --out-dir ./output

Outputs:
  <name>_rants.txt       — Your raw thoughts, ideas, mechanisms
  <name>_ai_responses.txt — AI's structured responses
  <name>_summary.txt     — Stats and overview
"""

import sys
import re
from pathlib import Path
from datetime import datetime


# ============================================================
# CLASSIFICATION ENGINE
# ============================================================

def score_line(line: str) -> float:
    """
    Score a line from -1.0 (definitely human) to +1.0 (definitely AI).
    0.0 = ambiguous.
    """
    stripped = line.strip()
    if not stripped:
        return 0.0

    score = 0.0
    length = len(stripped)

    # --- AI signals (positive) ---

    # Markdown formatting
    if re.match(r'^#{1,6}\s', stripped):
        score += 0.9  # Headers
    if re.match(r'^[-*+]\s', stripped):
        score += 0.7  # Bullet points
    if re.match(r'^\d+[\.\)]\s', stripped):
        score += 0.6  # Numbered lists
    if re.match(r'^\|.*\|', stripped):
        score += 0.9  # Table rows
    if re.match(r'^```', stripped):
        score += 0.9  # Code blocks
    if re.match(r'^>\s', stripped):
        score += 0.7  # Block quotes
    if re.match(r'^---+$', stripped):
        score += 0.5  # Horizontal rules

    # Structural AI patterns
    if re.match(r'^\*\*[A-Z].*\*\*', stripped):
        score += 0.6  # **Bold headers**
    if re.match(r'^(Option|Tier|Stage|Step|Phase|Component)\s+\d', stripped, re.I):
        score += 0.7
    if re.search(r'\b(Pros?|Cons?|Note|Important|Specifically|Implementation):', stripped):
        score += 0.5
    if '→' in stripped or '↳' in stripped or '—' in stripped:
        score += 0.3  # Arrows and em-dashes
    if re.match(r'^(My call|My recommendation|Bottom line|Best approach|This means):', stripped):
        score += 0.8
    if re.match(r'^(Here\'s|Let me|This is)', stripped):
        score += 0.3
    if re.match(r'^Your (instinct|idea|approach|point|take|thinking)', stripped):
        score += 0.5
    if re.match(r'^(Don\'t|Do not|Avoid|Never|Always)\s', stripped):
        score += 0.3
    if re.search(r'\$\d+[,-/]', stripped):
        score += 0.2  # Pricing tables

    # Short, structured line = AI
    if length < 80 and score > 0:
        score += 0.2

    # --- Human signals (negative) ---

    # Conversational filler
    fillers = [
        r'\byou know what I mean\b', r'\bright\?', r'\blike,\s', r'\bI mean\b',
        r'\bI don\'t know\b', r'\bI\'m saying\b', r'\bdude\b', r'\bman,\b',
        r'\bshit\b', r'\bbam\b', r'\bhell\b', r'\bdamn\b', r'\bliterally\b',
        r'\bwhat if\b', r'\bbut like\b', r'\bso like\b', r'\byou know\b',
        r'\bI just\b', r'\bI think\b', r'\bI want\b', r'\bI need\b',
        r'\bI feel like\b', r'\bcool\b', r'\banyways\b', r'\bthe thing is\b',
        r'\bthe point being\b', r'\bthe beauty of\b', r'\bthe problem is\b',
        r'\bthat\'s the\b.*\bthing\b', r'\bYou see\b', r'\bSee\?\b',
        r'\bOkay\b', r'\bOK\b', r'\byeah\b',
    ]
    filler_count = sum(1 for p in fillers if re.search(p, stripped, re.IGNORECASE))
    score -= filler_count * 0.2

    # Long unbroken lines without markdown = human
    if length > 300 and score <= 0:
        score -= 0.5
    if length > 500:
        score -= 0.4
    if length > 800:
        score -= 0.3

    # Multiple sentences crammed together (stream of consciousness)
    sentence_ends = len(re.findall(r'[.!?]\s+[A-Z]', stripped))
    if sentence_ends >= 3:
        score -= 0.3

    # Questions in sequence (thinking out loud)
    question_marks = stripped.count('?')
    if question_marks >= 2:
        score -= 0.2

    # Clamp
    return max(-1.0, min(1.0, score))


def classify_lines(lines: list[str]) -> list[dict]:
    """
    Classify every line, then use context smoothing to group into segments.
    Returns list of {'text': str, 'type': 'human'|'ai', 'line_start': int, 'line_end': int}
    """
    # Score every line
    scores = [score_line(line) for line in lines]

    # Context smoothing: a single line surrounded by opposite type
    # should be absorbed by its neighbors (prevents fragmentation)
    smoothed = scores.copy()
    for i in range(1, len(scores) - 1):
        if scores[i] == 0.0:  # Ambiguous lines take neighbor's classification
            smoothed[i] = (scores[i-1] + scores[i+1]) / 2

    # Build segments
    segments = []
    current_type = None
    current_lines = []
    current_start = 0

    for i, line in enumerate(lines):
        s = smoothed[i]
        if line.strip() == '':
            # Blank lines go with current segment
            current_lines.append(line)
            continue

        line_type = 'ai' if s > 0 else 'human' if s < 0 else 'ambiguous'

        # Resolve ambiguous based on context
        if line_type == 'ambiguous':
            line_type = current_type or 'ai'

        if current_type is None:
            current_type = line_type
            current_start = i

        if line_type != current_type:
            # Speaker change — save current segment
            if current_lines:
                segments.append({
                    'lines': current_lines,
                    'type': current_type,
                    'line_start': current_start + 1,
                    'line_end': i,
                })
            current_lines = [line]
            current_type = line_type
            current_start = i
        else:
            current_lines.append(line)

    # Don't forget the last segment
    if current_lines:
        segments.append({
            'lines': current_lines,
            'type': current_type,
            'line_start': current_start + 1,
            'line_end': len(lines),
        })

    return segments


def merge_small_segments(segments: list[dict], min_lines: int = 2) -> list[dict]:
    """
    Merge tiny segments (< min_lines of actual content) into their neighbors,
    but ONLY if they're the same type. Never merge human into AI or vice versa.
    """
    if len(segments) <= 1:
        return segments

    # First pass: merge adjacent same-type segments
    merged = [segments[0]]
    for seg in segments[1:]:
        if seg['type'] == merged[-1]['type']:
            merged[-1]['lines'].extend(seg['lines'])
            merged[-1]['line_end'] = seg['line_end']
        else:
            merged.append(seg)

    # Second pass: absorb tiny segments into neighbors ONLY if same type
    final = []
    for seg in merged:
        content_lines = [l for l in seg['lines'] if l.strip()]
        if len(content_lines) < min_lines and final and final[-1]['type'] == seg['type']:
            final[-1]['lines'].extend(seg['lines'])
            final[-1]['line_end'] = seg['line_end']
        else:
            final.append(seg)

    return final



def process_file(input_path: str, out_dir: str = None):
    """Main processing function."""
    input_path = Path(input_path)
    if not input_path.exists():
        print(f"Error: File not found: {input_path}")
        sys.exit(1)

    text = input_path.read_text(encoding='utf-8', errors='replace')
    lines = text.split('\n')
    total_chars = len(text)
    total_lines = len(lines)

    print(f"Processing: {input_path.name}")
    print(f"  {total_lines:,} lines, {total_chars:,} characters")
    print()

    # Classify
    segments = classify_lines(lines)
    segments = merge_small_segments(segments)

    # Separate by type (no dedup — repetition is how ideas evolve)
    human_segments = [s for s in segments if s['type'] == 'human']
    ai_segments = [s for s in segments if s['type'] == 'ai']

    human_text = '\n\n--- [Block] ---\n\n'.join(
        '\n'.join(s['lines']).strip() for s in human_segments
    )
    ai_text = '\n\n--- [Block] ---\n\n'.join(
        '\n'.join(s['lines']).strip() for s in ai_segments
    )

    human_line_count = sum(len([l for l in s['lines'] if l.strip()]) for s in human_segments)
    ai_line_count = sum(len([l for l in s['lines'] if l.strip()]) for s in ai_segments)

    # Output paths
    if out_dir:
        out_path = Path(out_dir)
    else:
        out_path = input_path.parent
    out_path.mkdir(parents=True, exist_ok=True)

    stem = input_path.stem
    rants_file = out_path / f"{stem}_rants.txt"
    ai_file = out_path / f"{stem}_ai_responses.txt"
    summary_file = out_path / f"{stem}_summary.txt"

    rants_file.write_text(human_text, encoding='utf-8')
    ai_file.write_text(ai_text, encoding='utf-8')

    # Segment map for debugging
    seg_map = ""
    for s in segments:
        content_preview = next((l.strip()[:80] for l in s['lines'] if l.strip()), '(empty)')
        lines_count = len([l for l in s['lines'] if l.strip()])
        seg_map += f"  Lines {s['line_start']:>5}-{s['line_end']:>5}  [{s['type']:>5}]  ({lines_count:>3} lines)  {content_preview}...\n"

    total_classified = human_line_count + ai_line_count
    h_pct = (human_line_count / total_classified * 100) if total_classified else 0
    a_pct = (ai_line_count / total_classified * 100) if total_classified else 0

    summary = f"""Chat Splitter Summary
====================
Source: {input_path.name}
Processed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

Total: {total_lines:,} lines / {total_chars:,} chars
Human rants: {human_line_count:,} lines ({len(human_segments)} blocks)
AI responses: {ai_line_count:,} lines ({len(ai_segments)} blocks)

Split: {h_pct:.1f}% human / {a_pct:.1f}% AI

Segment Map:
{seg_map}
Output files:
  Rants: {rants_file.name}
  AI:    {ai_file.name}
"""
    summary_file.write_text(summary, encoding='utf-8')

    print(f"Results:")
    print(f"  Human rants:  {human_line_count:,} lines ({len(human_segments)} blocks)")
    print(f"  AI responses: {ai_line_count:,} lines ({len(ai_segments)} blocks)")
    print(f"  Split: {h_pct:.1f}% human / {a_pct:.1f}% AI")
    print()
    print(f"Segment map:")
    print(seg_map)
    print(f"Output:")
    print(f"  {rants_file}")
    print(f"  {ai_file}")
    print(f"  {summary_file}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 chat-splitter.py <input_file> [--out-dir <dir>]")
        print()
        print("Splits exported chat logs into human rants vs AI responses.")
        print("Drop in any .txt chat export and get two clean files back.")
        sys.exit(1)

    input_file = sys.argv[1]
    out_dir = None
    if '--out-dir' in sys.argv:
        idx = sys.argv.index('--out-dir')
        if idx + 1 < len(sys.argv):
            out_dir = sys.argv[idx + 1]

    process_file(input_file, out_dir)


if __name__ == '__main__':
    main()
