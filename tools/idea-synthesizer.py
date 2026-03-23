#!/usr/bin/env python3
"""
Idea Synthesizer — Extracts mechanisms and ideas from conversation rants,
traces how they evolve, and builds a structured truth document.

This is NOT a cleaner. Repetition is signal — when the same concept appears
multiple times, it's the idea crystallizing. This tool tracks that evolution.

Usage:
  python3 idea-synthesizer.py <input_file>
  python3 idea-synthesizer.py <input_file> --out-dir ./output

Input: Raw text (full chat export or rants-only output from chat-splitter.py)

Outputs:
  <name>_mechanisms.txt  — Every concrete system/process/pattern found
  <name>_ideas.txt       — Every concept/vision/strategy found
  <name>_truth.txt       — Synthesized truth: mechanisms matched to ideas
  <name>_gaps.txt        — Mechanisms mentioned early but missing from final ideas
"""

import sys
import re
import hashlib
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, field


# ============================================================
# DATA STRUCTURES
# ============================================================

@dataclass
class Extract:
    """A single extracted mechanism or idea."""
    text: str                      # The raw text
    category: str                  # 'mechanism' or 'idea'
    position: float                # 0.0 = start of doc, 1.0 = end
    line_number: int               # Source line
    confidence: float              # How confident the classification is
    keywords: list[str] = field(default_factory=list)
    fingerprint: str = ''          # For tracking evolution

    def __post_init__(self):
        # Create a keyword-based fingerprint for matching across positions
        self.fingerprint = self._make_fingerprint()

    def _make_fingerprint(self) -> str:
        """Extract core nouns/concepts for matching similar ideas."""
        words = re.findall(r'\b[a-z]{4,}\b', self.text.lower())
        # Remove very common words
        stopwords = {
            'that', 'this', 'with', 'from', 'they', 'them', 'their', 'then',
            'than', 'have', 'been', 'were', 'would', 'could', 'should', 'about',
            'going', 'just', 'like', 'know', 'mean', 'think', 'want', 'need',
            'make', 'made', 'right', 'thing', 'things', 'really', 'because',
            'actually', 'basically', 'literally', 'something', 'anything',
            'everything', 'also', 'well', 'even', 'still', 'back', 'over',
            'into', 'when', 'what', 'where', 'which', 'while', 'being',
            'does', 'done', 'doing', 'some', 'other', 'each', 'every',
            'more', 'most', 'much', 'many', 'very', 'only',
        }
        content_words = [w for w in words if w not in stopwords]
        return ' '.join(sorted(set(content_words)))


@dataclass
class Truth:
    """A synthesized truth — an idea matched with its supporting mechanisms."""
    core_statement: str            # The distilled idea
    mechanisms: list[Extract]      # Supporting mechanisms
    evolution: list[Extract]       # How the idea evolved (chronological)
    position_range: tuple          # (earliest mention, latest mention)
    strength: int                  # How many times it was referenced


# ============================================================
# EXTRACTION ENGINE
# ============================================================

# Mechanism indicators — concrete systems, processes, technical patterns
MECHANISM_PATTERNS = [
    # Technical systems
    (r'\b(agent|pipeline|system|engine|workflow|process|protocol)\b', 0.4),
    (r'\b(API|endpoint|database|migration|webhook|middleware)\b', 0.5),
    (r'\b(encrypt|auth|token|session|cache|queue)\b', 0.4),
    # Build/deploy patterns
    (r'\b(build|deploy|test|lint|compile|bundle)\b', 0.3),
    (r'\b(phase\s*\d|stage\s*\d|step\s*\d|tier\s*\d)\b', 0.5),
    (r'\b(bash|CLI|command|script|automation)\b', 0.4),
    # Architecture
    (r'\b(diff\s*check|validation|verification|integrity)\b', 0.5),
    (r'\b(PRD|spec|schema|manifest|config)\b', 0.4),
    (r'\b(sandbox|container|docker|vercel|railway)\b', 0.4),
    # Process flows
    (r'\b(input|output|transform|parse|extract|inject)\b', 0.3),
    (r'\b(chain|sequence|cascade|pipeline|flow)\b', 0.4),
    (r'\b(trigger|fire|execute|invoke|spawn)\b', 0.3),
    # Data patterns
    (r'\b(JSON|YAML|markdown|template|prompt)\b', 0.4),
    (r'\b(file|folder|directory|path|repo)\b', 0.3),
]

# Idea indicators — concepts, visions, strategies, business logic
IDEA_PATTERNS = [
    # Business/strategy
    (r'\b(subscription|revenue|monetize|pricing|customer)\b', 0.5),
    (r'\b(moat|competitive|advantage|differentiat|market)\b', 0.5),
    (r'\b(pitch|sell|offer|value\s*prop|positioning)\b', 0.4),
    # Vision/concept
    (r'\b(vision|concept|philosophy|principle|approach)\b', 0.4),
    (r'\b(imagine|picture|envision|dream|future)\b', 0.3),
    (r'\b(beauty|genius|brilliant|incredible|game.?changer)\b', 0.3),
    # Strategy
    (r'\b(strategy|tactic|play|move|angle)\b', 0.4),
    (r'\b(flexibility|agnostic|universal|platform)\b', 0.4),
    (r'\b(escape\s*hatch|fallback|safety\s*net|insurance)\b', 0.5),
    # User experience
    (r'\b(experience|journey|flow|onboard|friction)\b', 0.3),
    (r'\b(choice|option|picker|selector|customize)\b', 0.3),
    # Meta/self-referential thinking
    (r'\b(reverse\s*engineer|copy|steal|compete|clone)\b', 0.4),
    (r'\b(protect|IP|secret|sauce|proprietary)\b', 0.5),
    (r'\b(living|breathing|evolving|morphing)\b', 0.4),
]

# Conversational filler — used to determine if a line is stream-of-consciousness
FILLER_PATTERNS = [
    r'\byou know what I mean\b', r'\bright\?', r'\blike,\s', r'\bI mean\b',
    r"\bI don't know\b", r"\bI'm saying\b", r'\bman,\b',
    r'\bwhat if\b', r'\bbut like\b', r'\bso like\b', r'\byou know\b',
    r'\bthe thing is\b', r'\bthe point being\b', r'\bthe beauty of\b',
]


def score_extract(line: str, patterns: list[tuple]) -> tuple[float, list[str]]:
    """Score a line against a set of patterns. Returns (score, matched_keywords)."""
    score = 0.0
    keywords = []
    for pattern, weight in patterns:
        matches = re.findall(pattern, line, re.IGNORECASE)
        if matches:
            score += weight
            keywords.extend(matches)
    return score, keywords


def extract_from_line(line: str, line_num: int, total_lines: int) -> list[Extract]:
    """Extract mechanisms and ideas from a single line."""
    stripped = line.strip()
    if not stripped or len(stripped) < 20:
        return []

    position = line_num / max(total_lines, 1)

    mech_score, mech_keywords = score_extract(stripped, MECHANISM_PATTERNS)
    idea_score, idea_keywords = score_extract(stripped, IDEA_PATTERNS)

    # Count filler — high filler = stream of consciousness (more likely ideas)
    filler_count = sum(1 for p in FILLER_PATTERNS if re.search(p, stripped, re.IGNORECASE))

    extracts = []

    # A line can contain BOTH mechanisms and ideas
    if mech_score >= 0.5:
        extracts.append(Extract(
            text=stripped,
            category='mechanism',
            position=position,
            line_number=line_num,
            confidence=min(mech_score, 1.0),
            keywords=mech_keywords,
        ))

    if idea_score >= 0.4:
        extracts.append(Extract(
            text=stripped,
            category='idea',
            position=position,
            line_number=line_num,
            confidence=min(idea_score, 1.0),
            keywords=idea_keywords,
        ))

    # Lines with lots of filler + some content = idea exploration
    if filler_count >= 2 and (mech_score > 0 or idea_score > 0) and not any(e.category == 'idea' for e in extracts):
        extracts.append(Extract(
            text=stripped,
            category='idea',
            position=position,
            line_number=line_num,
            confidence=0.3,
            keywords=idea_keywords or mech_keywords,
        ))

    return extracts


# ============================================================
# EVOLUTION TRACKING
# ============================================================

def word_overlap(a: str, b: str) -> float:
    """Calculate word overlap ratio between two fingerprints."""
    words_a = set(a.split())
    words_b = set(b.split())
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union)  # Jaccard similarity


def find_evolution_chains(extracts: list[Extract], threshold: float = 0.35) -> list[list[Extract]]:
    """
    Group extracts that are about the same topic into evolution chains.
    Sorted chronologically within each chain so you can see how the idea grew.
    """
    if not extracts:
        return []

    # Sort by position (chronological)
    sorted_extracts = sorted(extracts, key=lambda e: e.position)

    chains: list[list[Extract]] = []
    assigned = set()

    for i, extract in enumerate(sorted_extracts):
        if i in assigned:
            continue

        chain = [extract]
        assigned.add(i)

        # Find all related extracts
        for j, other in enumerate(sorted_extracts):
            if j in assigned:
                continue
            if word_overlap(extract.fingerprint, other.fingerprint) >= threshold:
                chain.append(other)
                assigned.add(j)

        chains.append(chain)

    # Sort chains by length (most evolved first)
    chains.sort(key=lambda c: len(c), reverse=True)

    return chains


# ============================================================
# TRUTH BUILDING
# ============================================================

def build_truths(mechanisms: list[Extract], ideas: list[Extract]) -> list[Truth]:
    """
    Match distilled ideas (late in doc) with supporting mechanisms (throughout doc).
    Returns synthesized truths.
    """
    # Find evolution chains for ideas
    idea_chains = find_evolution_chains(ideas)

    truths = []

    for chain in idea_chains:
        if not chain:
            continue

        # The latest version in the chain is the most distilled
        latest = max(chain, key=lambda e: e.position)

        # Find mechanisms that match this idea's keywords
        matching_mechs = []
        for mech in mechanisms:
            overlap = word_overlap(latest.fingerprint, mech.fingerprint)
            if overlap >= 0.15:  # Lower threshold — mechanisms might use different words
                matching_mechs.append(mech)

        # Also check direct keyword overlap
        idea_kw = set(w.lower() for w in latest.keywords)
        for mech in mechanisms:
            mech_kw = set(w.lower() for w in mech.keywords)
            if idea_kw & mech_kw and mech not in matching_mechs:
                matching_mechs.append(mech)

        positions = [e.position for e in chain]

        truths.append(Truth(
            core_statement=latest.text,
            mechanisms=matching_mechs,
            evolution=sorted(chain, key=lambda e: e.position),
            position_range=(min(positions), max(positions)),
            strength=len(chain),
        ))

    # Sort by strength (most referenced = most important)
    truths.sort(key=lambda t: t.strength, reverse=True)

    return truths


def find_gaps(mechanisms: list[Extract], truths: list[Truth]) -> list[Extract]:
    """
    Find mechanisms that were discussed but didn't match any truth.
    These are potential gaps — things that got mentioned but dropped.
    """
    matched_mechs = set()
    for truth in truths:
        for mech in truth.mechanisms:
            matched_mechs.add(mech.line_number)

    gaps = [m for m in mechanisms if m.line_number not in matched_mechs]
    return gaps


# ============================================================
# OUTPUT FORMATTING
# ============================================================

def format_mechanisms(mechanisms: list[Extract]) -> str:
    """Format mechanisms list for output."""
    if not mechanisms:
        return "(No mechanisms found)\n"

    out = ""
    # Group by position (early / middle / late)
    early = [m for m in mechanisms if m.position < 0.33]
    middle = [m for m in mechanisms if 0.33 <= m.position < 0.66]
    late = [m for m in mechanisms if m.position >= 0.66]

    for label, group in [("EARLY (raw exploration)", early), ("MIDDLE (developing)", middle), ("LATE (refined)", late)]:
        if not group:
            continue
        out += f"\n{'='*60}\n{label}\n{'='*60}\n\n"
        for m in sorted(group, key=lambda x: x.line_number):
            kw = ', '.join(set(m.keywords[:5]))
            out += f"  [L{m.line_number}] ({m.confidence:.0%}) [{kw}]\n"
            # Truncate very long lines for readability
            display = m.text if len(m.text) <= 200 else m.text[:200] + '...'
            out += f"  {display}\n\n"

    return out


def format_ideas(ideas: list[Extract], chains: list[list[Extract]]) -> str:
    """Format ideas with evolution chains."""
    if not ideas:
        return "(No ideas found)\n"

    out = ""

    for i, chain in enumerate(chains):
        out += f"\n{'='*60}\n"
        out += f"IDEA THREAD #{i+1} (mentioned {len(chain)}x, evolved {chain[0].position:.0%} → {chain[-1].position:.0%})\n"
        out += f"{'='*60}\n\n"

        for j, extract in enumerate(chain):
            stage = "SEED" if extract.position < 0.33 else "GROWING" if extract.position < 0.66 else "CRYSTALLIZED"
            kw = ', '.join(set(extract.keywords[:5]))
            out += f"  [{stage}] L{extract.line_number} ({extract.confidence:.0%}) [{kw}]\n"
            display = extract.text if len(extract.text) <= 300 else extract.text[:300] + '...'
            out += f"  {display}\n\n"

    return out


def format_truths(truths: list[Truth]) -> str:
    """Format the synthesized truth document."""
    if not truths:
        return "(No truths synthesized — need more content)\n"

    out = ""
    out += "=" * 60 + "\n"
    out += "SYNTHESIZED TRUTHS\n"
    out += "Distilled ideas matched against supporting mechanisms\n"
    out += "=" * 60 + "\n\n"

    for i, truth in enumerate(truths):
        out += f"{'─'*60}\n"
        out += f"TRUTH #{i+1}  (strength: {truth.strength}x, span: {truth.position_range[0]:.0%}→{truth.position_range[1]:.0%})\n"
        out += f"{'─'*60}\n\n"

        # Core statement (the most distilled version)
        display = truth.core_statement if len(truth.core_statement) <= 500 else truth.core_statement[:500] + '...'
        out += f"  CORE: {display}\n\n"

        # Evolution trail
        if len(truth.evolution) > 1:
            out += f"  EVOLUTION ({len(truth.evolution)} stages):\n"
            for j, evo in enumerate(truth.evolution):
                stage = "SEED" if evo.position < 0.33 else "GROWING" if evo.position < 0.66 else "FINAL"
                snippet = evo.text[:150] + '...' if len(evo.text) > 150 else evo.text
                out += f"    {j+1}. [{stage} L{evo.line_number}] {snippet}\n"
            out += "\n"

        # Supporting mechanisms
        if truth.mechanisms:
            out += f"  SUPPORTING MECHANISMS ({len(truth.mechanisms)}):\n"
            for mech in sorted(truth.mechanisms, key=lambda m: m.line_number):
                snippet = mech.text[:150] + '...' if len(mech.text) > 150 else mech.text
                out += f"    • [L{mech.line_number}] {snippet}\n"
            out += "\n"
        else:
            out += "  ⚠ NO SUPPORTING MECHANISMS FOUND — idea may be unsupported\n\n"

    return out


def format_gaps(gaps: list[Extract]) -> str:
    """Format the gaps report."""
    if not gaps:
        return "No gaps found — all mechanisms are connected to ideas.\n"

    out = ""
    out += "=" * 60 + "\n"
    out += "ORPHANED MECHANISMS\n"
    out += "These were discussed but don't connect to any distilled idea.\n"
    out += "They might be: dropped concepts, implementation details,\n"
    out += "or mechanisms that should be reconnected to a truth.\n"
    out += "=" * 60 + "\n\n"

    for gap in sorted(gaps, key=lambda g: g.line_number):
        position_label = "early" if gap.position < 0.33 else "mid" if gap.position < 0.66 else "late"
        kw = ', '.join(set(gap.keywords[:5]))
        out += f"  [L{gap.line_number}, {position_label}] [{kw}]\n"
        display = gap.text if len(gap.text) <= 200 else gap.text[:200] + '...'
        out += f"  {display}\n\n"

    return out


# ============================================================
# MAIN PROCESSING
# ============================================================

def process_file(input_path: str, out_dir: str = None):
    """Main processing function."""
    input_path = Path(input_path)
    if not input_path.exists():
        print(f"Error: File not found: {input_path}")
        sys.exit(1)

    text = input_path.read_text(encoding='utf-8', errors='replace')
    lines = text.split('\n')
    total_lines = len(lines)

    print(f"Processing: {input_path.name}")
    print(f"  {total_lines:,} lines, {len(text):,} characters")
    print()

    # Phase 1: Extract everything
    all_mechanisms = []
    all_ideas = []

    for i, line in enumerate(lines):
        extracts = extract_from_line(line, i + 1, total_lines)
        for ext in extracts:
            if ext.category == 'mechanism':
                all_mechanisms.append(ext)
            else:
                all_ideas.append(ext)

    print(f"Extracted:")
    print(f"  Mechanisms: {len(all_mechanisms)}")
    print(f"  Ideas: {len(all_ideas)}")

    # Phase 2: Find evolution chains
    idea_chains = find_evolution_chains(all_ideas)
    mech_chains = find_evolution_chains(all_mechanisms)

    print(f"  Idea threads: {len(idea_chains)}")
    print(f"  Mechanism threads: {len(mech_chains)}")

    # Phase 3: Build truths
    truths = build_truths(all_mechanisms, all_ideas)
    print(f"  Synthesized truths: {len(truths)}")

    # Phase 4: Find gaps
    gaps = find_gaps(all_mechanisms, truths)
    print(f"  Orphaned mechanisms: {len(gaps)}")
    print()

    # Output
    if out_dir:
        out_path = Path(out_dir)
    else:
        out_path = input_path.parent
    out_path.mkdir(parents=True, exist_ok=True)

    stem = input_path.stem

    # Mechanisms file
    mech_file = out_path / f"{stem}_mechanisms.txt"
    mech_file.write_text(
        f"Mechanisms extracted from: {input_path.name}\n"
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"Total: {len(all_mechanisms)} mechanisms in {len(mech_chains)} threads\n\n"
        + format_mechanisms(all_mechanisms),
        encoding='utf-8'
    )

    # Ideas file
    ideas_file = out_path / f"{stem}_ideas.txt"
    ideas_file.write_text(
        f"Ideas extracted from: {input_path.name}\n"
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"Total: {len(all_ideas)} ideas in {len(idea_chains)} threads\n\n"
        + format_ideas(all_ideas, idea_chains),
        encoding='utf-8'
    )

    # Truth file
    truth_file = out_path / f"{stem}_truth.txt"
    truth_file.write_text(
        f"Synthesized truth from: {input_path.name}\n"
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"Truths: {len(truths)} | Mechanisms: {len(all_mechanisms)} | Ideas: {len(all_ideas)}\n\n"
        + format_truths(truths),
        encoding='utf-8'
    )

    # Gaps file
    gaps_file = out_path / f"{stem}_gaps.txt"
    gaps_file.write_text(
        f"Gap analysis from: {input_path.name}\n"
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"Orphaned mechanisms: {len(gaps)} out of {len(all_mechanisms)} total\n\n"
        + format_gaps(gaps),
        encoding='utf-8'
    )

    print(f"Output:")
    print(f"  {mech_file}")
    print(f"  {ideas_file}")
    print(f"  {truth_file}")
    print(f"  {gaps_file}")


def main():
    if len(sys.argv) < 2:
        print("Idea Synthesizer — Extract mechanisms and ideas, build truth")
        print()
        print("Usage: python3 idea-synthesizer.py <input_file> [--out-dir <dir>]")
        print()
        print("Takes raw conversation text and produces:")
        print("  _mechanisms.txt  — Every concrete system/process/pattern")
        print("  _ideas.txt       — Every concept/vision/strategy with evolution tracking")
        print("  _truth.txt       — Synthesized truths: ideas matched to mechanisms")
        print("  _gaps.txt        — Mechanisms mentioned but missing from final ideas")
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
