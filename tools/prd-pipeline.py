#!/usr/bin/env python3
"""
PRD Idea Extraction Pipeline — Three-Agent System

Takes a conversation transcript (txt, md, or docx) and runs it through
three adversarial agents to extract mechanisms, ideas, and build a truth document.

Agent 1 (EXTRACTOR): Pulls exact quotes, classifies as mechanism/idea
Agent 2 (CHALLENGER): Finds what Agent 1 missed
Agent 3 (FEASIBILITY): Says what can't actually be built

Each agent's output is saved separately so you can inspect what each one did.

Setup:
  pip install anthropic
  pip install python-docx   # only if processing .docx files
  export ANTHROPIC_API_KEY=sk-ant-...

Usage:
  python3 prd-pipeline.py input.txt
  python3 prd-pipeline.py input.docx --out-dir ./results
  python3 prd-pipeline.py input.txt --chunk-size 40 --model claude-sonnet-4-20250514
"""

import sys
import os
import json
import re
import time
import argparse
from pathlib import Path
from datetime import datetime
from typing import Optional


# ============================================================
# CONFIGURATION
# ============================================================

DEFAULT_MODEL = "claude-sonnet-4-20250514"
DEFAULT_CHUNK_SIZE = 50  # lines per chunk
MAX_RETRIES = 2
RETRY_DELAY = 1.0


# ============================================================
# AGENT SYSTEM PROMPTS — These are the "MD files" that lock behavior
# ============================================================

EXTRACTOR_SYSTEM = """You are a STRICT extraction agent. Your ONLY job is to read a chunk of text from a conversation and extract every mechanism and idea present.

RULES — VIOLATION OF ANY RULE MEANS FAILURE:
1. You output ONLY valid JSON. No commentary. No markdown. No explanations.
2. The "exact_quote" field MUST contain the user's ACTUAL words copied from the input. DO NOT paraphrase. DO NOT summarize. DO NOT rewrite.
3. Every paragraph that contains a mechanism or idea MUST produce an extraction. Do not skip.
4. A "mechanism" is something concrete and buildable — a system, process, technical pattern, workflow, architecture decision. If you could write code for it or put it in a spec, it's a mechanism.
5. An "idea" is a concept, vision, strategy, business model, or philosophical stance. The WHY behind things.
6. A single passage can contain BOTH a mechanism and an idea. Extract both separately.
7. "buildable" means: could a developer build this with current technology in under a month? Be honest.
8. "missing_details" — what would a developer need to know to actually build this? Be specific.

OUTPUT FORMAT — exactly this JSON array, nothing else:
[
  {
    "type": "mechanism",
    "exact_quote": "the user's actual words from the text",
    "summary": "one sentence describing what this is",
    "buildable": true,
    "missing_details": ["specific thing needed", "another thing needed"],
    "keywords": ["keyword1", "keyword2"]
  }
]

If the chunk contains nothing extractable, output: []"""


CHALLENGER_SYSTEM = """You are an ADVERSARIAL review agent. Your ONLY job is to find what the Extractor missed.

You receive:
1. The original text chunk
2. What the Extractor found

Your job: find GAPS. What did the Extractor miss? What details were in the text but not captured?

RULES — VIOLATION OF ANY RULE MEANS FAILURE:
1. You output ONLY valid JSON. No commentary. No markdown.
2. Focus on MISSED DETAILS — specific technical details, constraints, relationships between concepts, conditions, edge cases that were stated in the text but not in the extractions.
3. If the Extractor did a perfect job, output an empty array. Do NOT invent gaps that aren't real.
4. The "source_quote" MUST be the user's actual words that contain the missed detail.
5. Be specific about WHY it matters — not vague.

OUTPUT FORMAT — exactly this JSON array, nothing else:
[
  {
    "missed_item": "description of what was missed",
    "source_quote": "exact words from the original text",
    "why_it_matters": "specific reason this detail is important for building",
    "category": "mechanism_detail | idea_nuance | constraint | dependency | edge_case"
  }
]

If nothing was missed, output: []"""


FEASIBILITY_SYSTEM = """You are a SKEPTICAL feasibility agent. Your job is to challenge every mechanism and say what CANNOT actually be built, what's missing, and what's unrealistic.

You are NOT optimistic. You are NOT encouraging. You are an engineer who has to actually build this and you need to know what's real.

RULES — VIOLATION OF ANY RULE MEANS FAILURE:
1. You output ONLY valid JSON. No commentary. No markdown.
2. For each mechanism, give an honest feasibility rating.
3. "blockers" — specific technical reasons it can't be built as described. Empty array if none.
4. "missing_to_build" — what would need to exist or be decided before this could be built. Be specific.
5. "verdict" — one of: "buildable_now", "buildable_with_work", "needs_research", "not_feasible", "too_vague"
6. DO NOT just say "great idea." If something is vague, say it's vague. If it can't work, say why.

OUTPUT FORMAT — exactly this JSON array, nothing else:
[
  {
    "mechanism_summary": "what this mechanism is",
    "verdict": "buildable_now | buildable_with_work | needs_research | not_feasible | too_vague",
    "confidence": 0.0 to 1.0,
    "blockers": ["specific technical reason it can't work as described"],
    "missing_to_build": ["specific thing needed before building"],
    "reality_check": "one honest sentence about whether this is real or fantasy"
  }
]"""


# ============================================================
# INPUT HANDLING
# ============================================================

def read_input(file_path: Path) -> str:
    """Read input from txt, md, or docx files."""
    suffix = file_path.suffix.lower()

    if suffix == '.docx':
        try:
            from docx import Document
        except ImportError:
            print("Error: python-docx not installed. Run: pip install python-docx")
            sys.exit(1)
        doc = Document(str(file_path))
        return '\n'.join(para.text for para in doc.paragraphs)

    # Plain text / markdown
    return file_path.read_text(encoding='utf-8', errors='replace')


# ============================================================
# DETERMINISTIC CHUNKING
# ============================================================

def chunk_text(text: str, chunk_size: int) -> list[dict]:
    """
    Split text into chunks of approximately chunk_size lines.
    Tries to break at paragraph boundaries (blank lines).
    Each chunk includes its position in the document.
    """
    lines = text.split('\n')
    total = len(lines)
    chunks = []
    current_lines = []
    chunk_start = 1

    for i, line in enumerate(lines):
        current_lines.append(line)

        # Break at chunk_size or at paragraph boundaries near chunk_size
        at_boundary = (line.strip() == '' and len(current_lines) >= chunk_size * 0.7)
        at_limit = len(current_lines) >= chunk_size * 1.3

        if at_boundary or at_limit or i == len(lines) - 1:
            if any(l.strip() for l in current_lines):  # skip empty chunks
                chunk_end = chunk_start + len(current_lines) - 1
                chunks.append({
                    'text': '\n'.join(current_lines),
                    'line_start': chunk_start,
                    'line_end': chunk_end,
                    'position': chunk_start / max(total, 1),  # 0.0 = start, 1.0 = end
                    'position_label': 'early' if chunk_start / total < 0.33 else 'middle' if chunk_start / total < 0.66 else 'late',
                })
            chunk_start = chunk_start + len(current_lines)
            current_lines = []

    return chunks


# ============================================================
# API CALLING WITH SCHEMA VALIDATION
# ============================================================

def call_agent(client, model: str, system_prompt: str, user_message: str, agent_name: str) -> list[dict]:
    """
    Call Claude with a system prompt and user message.
    Validates that the response is valid JSON array.
    Retries on failure.
    """
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=4096,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
                temperature=0.0,  # minimize randomness
            )

            raw = response.content[0].text.strip()

            # Strip markdown code fences if the model wrapped it
            if raw.startswith('```'):
                raw = re.sub(r'^```\w*\n?', '', raw)
                raw = re.sub(r'\n?```$', '', raw)
                raw = raw.strip()

            parsed = json.loads(raw)

            if not isinstance(parsed, list):
                raise ValueError(f"Expected JSON array, got {type(parsed).__name__}")

            return parsed

        except json.JSONDecodeError as e:
            if attempt < MAX_RETRIES:
                print(f"    [{agent_name}] Invalid JSON (attempt {attempt + 1}), retrying...")
                time.sleep(RETRY_DELAY)
            else:
                print(f"    [{agent_name}] FAILED: Could not get valid JSON after {MAX_RETRIES + 1} attempts")
                print(f"    Raw output: {raw[:200]}...")
                return []

        except Exception as e:
            if attempt < MAX_RETRIES:
                print(f"    [{agent_name}] Error: {e} (attempt {attempt + 1}), retrying...")
                time.sleep(RETRY_DELAY)
            else:
                print(f"    [{agent_name}] FAILED: {e}")
                return []

    return []


# ============================================================
# VALIDATION (deterministic — no AI)
# ============================================================

def validate_extraction(item: dict) -> tuple[bool, str]:
    """Validate a single extraction from Agent 1."""
    required = ['type', 'exact_quote', 'summary', 'buildable', 'missing_details', 'keywords']
    for field in required:
        if field not in item:
            return False, f"Missing field: {field}"

    if item['type'] not in ('mechanism', 'idea', 'both'):
        return False, f"Invalid type: {item['type']}"

    if not isinstance(item['exact_quote'], str) or len(item['exact_quote']) < 10:
        return False, "exact_quote too short or not a string"

    if not isinstance(item['buildable'], bool):
        return False, "buildable must be boolean"

    if not isinstance(item['missing_details'], list):
        return False, "missing_details must be array"

    return True, "ok"


def validate_challenge(item: dict) -> tuple[bool, str]:
    """Validate a single challenge from Agent 2."""
    required = ['missed_item', 'source_quote', 'why_it_matters', 'category']
    for field in required:
        if field not in item:
            return False, f"Missing field: {field}"

    valid_cats = ['mechanism_detail', 'idea_nuance', 'constraint', 'dependency', 'edge_case']
    if item['category'] not in valid_cats:
        return False, f"Invalid category: {item['category']}"

    return True, "ok"


def validate_feasibility(item: dict) -> tuple[bool, str]:
    """Validate a single feasibility check from Agent 3."""
    required = ['mechanism_summary', 'verdict', 'confidence', 'blockers', 'missing_to_build', 'reality_check']
    for field in required:
        if field not in item:
            return False, f"Missing field: {field}"

    valid_verdicts = ['buildable_now', 'buildable_with_work', 'needs_research', 'not_feasible', 'too_vague']
    if item['verdict'] not in valid_verdicts:
        return False, f"Invalid verdict: {item['verdict']}"

    return True, "ok"


def validate_and_filter(items: list[dict], validator_fn, agent_name: str) -> list[dict]:
    """Run validation on all items, keep valid ones, report invalid."""
    valid = []
    invalid_count = 0
    for item in items:
        ok, reason = validator_fn(item)
        if ok:
            valid.append(item)
        else:
            invalid_count += 1
            # Don't spam — just count
    if invalid_count:
        print(f"    [{agent_name}] Rejected {invalid_count} invalid items")
    return valid


# ============================================================
# TRUTH DOCUMENT BUILDER (deterministic merge)
# ============================================================

def build_truth_document(all_extractions: list, all_challenges: list, all_feasibility: list) -> str:
    """Merge all agent outputs into the final truth document."""

    out = []
    out.append("=" * 70)
    out.append("TRUTH DOCUMENT")
    out.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    out.append("=" * 70)
    out.append("")

    # Separate mechanisms and ideas
    mechanisms = [e for e in all_extractions if e.get('type') in ('mechanism', 'both')]
    ideas = [e for e in all_extractions if e.get('type') in ('idea', 'both')]

    # Build feasibility lookup
    feasibility_map = {}
    for f in all_feasibility:
        feasibility_map[f.get('mechanism_summary', '')] = f

    # --- MECHANISMS ---
    out.append("-" * 70)
    out.append(f"MECHANISMS ({len(mechanisms)} found)")
    out.append("-" * 70)
    out.append("")

    for i, mech in enumerate(mechanisms):
        out.append(f"  MECHANISM #{i+1}")
        out.append(f"  Summary: {mech.get('summary', 'N/A')}")
        out.append(f"  Buildable: {'YES' if mech.get('buildable') else 'NO'}")
        out.append(f"  Source [{mech.get('position_label', '?')}, L{mech.get('line_start', '?')}-{mech.get('line_end', '?')}]:")
        out.append(f"    \"{mech.get('exact_quote', '')}\"")
        if mech.get('missing_details'):
            out.append(f"  Missing details:")
            for d in mech['missing_details']:
                out.append(f"    - {d}")

        # Find matching feasibility check
        best_match = None
        mech_summary_lower = mech.get('summary', '').lower()
        for f in all_feasibility:
            if any(kw in f.get('mechanism_summary', '').lower() for kw in mech_summary_lower.split()[:3]):
                best_match = f
                break

        if best_match:
            out.append(f"  FEASIBILITY: {best_match.get('verdict', 'unknown')} ({best_match.get('confidence', 0):.0%})")
            out.append(f"  Reality check: {best_match.get('reality_check', 'N/A')}")
            if best_match.get('blockers'):
                out.append(f"  Blockers:")
                for b in best_match['blockers']:
                    out.append(f"    ! {b}")
            if best_match.get('missing_to_build'):
                out.append(f"  Needed to build:")
                for m in best_match['missing_to_build']:
                    out.append(f"    - {m}")

        out.append("")

    # --- IDEAS ---
    out.append("-" * 70)
    out.append(f"IDEAS ({len(ideas)} found)")
    out.append("-" * 70)
    out.append("")

    for i, idea in enumerate(ideas):
        out.append(f"  IDEA #{i+1}")
        out.append(f"  Summary: {idea.get('summary', 'N/A')}")
        out.append(f"  Source [{idea.get('position_label', '?')}, L{idea.get('line_start', '?')}-{idea.get('line_end', '?')}]:")
        out.append(f"    \"{idea.get('exact_quote', '')}\"")
        if idea.get('missing_details'):
            out.append(f"  To flesh out:")
            for d in idea['missing_details']:
                out.append(f"    - {d}")
        out.append("")

    # --- GAPS (from Challenger) ---
    if all_challenges:
        out.append("-" * 70)
        out.append(f"GAPS FOUND BY CHALLENGER ({len(all_challenges)} missed items)")
        out.append("-" * 70)
        out.append("")

        for i, gap in enumerate(all_challenges):
            out.append(f"  GAP #{i+1}: {gap.get('missed_item', 'N/A')}")
            out.append(f"  Category: {gap.get('category', 'N/A')}")
            out.append(f"  Source: \"{gap.get('source_quote', '')}\"")
            out.append(f"  Why it matters: {gap.get('why_it_matters', 'N/A')}")
            out.append(f"  From: [{gap.get('position_label', '?')}, L{gap.get('line_start', '?')}-{gap.get('line_end', '?')}]")
            out.append("")

    # --- FEASIBILITY SUMMARY ---
    if all_feasibility:
        out.append("-" * 70)
        out.append("FEASIBILITY SUMMARY")
        out.append("-" * 70)
        out.append("")

        verdicts = {}
        for f in all_feasibility:
            v = f.get('verdict', 'unknown')
            verdicts[v] = verdicts.get(v, 0) + 1

        for v, count in sorted(verdicts.items(), key=lambda x: -x[1]):
            out.append(f"  {v}: {count}")
        out.append("")

        # List the not-feasible and too-vague ones prominently
        problems = [f for f in all_feasibility if f.get('verdict') in ('not_feasible', 'too_vague')]
        if problems:
            out.append("  PROBLEMS:")
            for f in problems:
                out.append(f"    [{f.get('verdict')}] {f.get('mechanism_summary')}")
                out.append(f"      {f.get('reality_check')}")
            out.append("")

    return '\n'.join(out)


# ============================================================
# MAIN PIPELINE
# ============================================================

def run_pipeline(input_path: str, out_dir: str = None, chunk_size: int = DEFAULT_CHUNK_SIZE, model: str = DEFAULT_MODEL):
    """Run the full three-agent pipeline."""

    # Check API key
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set.")
        print("  export ANTHROPIC_API_KEY=sk-ant-...")
        sys.exit(1)

    try:
        from anthropic import Anthropic
    except ImportError:
        print("Error: anthropic package not installed.")
        print("  pip install anthropic")
        sys.exit(1)

    client = Anthropic(api_key=api_key)

    # Read input
    input_path = Path(input_path)
    if not input_path.exists():
        print(f"Error: File not found: {input_path}")
        sys.exit(1)

    print(f"Reading: {input_path.name}")
    text = read_input(input_path)
    lines = text.split('\n')
    print(f"  {len(lines):,} lines, {len(text):,} characters")
    print(f"  Model: {model}")
    print(f"  Chunk size: {chunk_size} lines")
    print()

    # Chunk (deterministic)
    chunks = chunk_text(text, chunk_size)
    print(f"Split into {len(chunks)} chunks")
    print()

    # Prepare output directory
    if out_dir:
        out_path = Path(out_dir)
    else:
        out_path = input_path.parent / f"{input_path.stem}_pipeline_output"
    out_path.mkdir(parents=True, exist_ok=True)

    # ============================================================
    # AGENT 1: EXTRACTOR
    # ============================================================
    print("=" * 60)
    print("AGENT 1: EXTRACTOR")
    print("  Extracting mechanisms and ideas from each chunk...")
    print("=" * 60)

    all_extractions = []
    agent1_raw = []  # for inspection

    for i, chunk in enumerate(chunks):
        print(f"  Chunk {i+1}/{len(chunks)} [L{chunk['line_start']}-{chunk['line_end']}, {chunk['position_label']}]", end=' ')

        results = call_agent(
            client, model, EXTRACTOR_SYSTEM,
            f"Extract all mechanisms and ideas from this text:\n\n{chunk['text']}",
            "EXTRACTOR"
        )

        valid = validate_and_filter(results, validate_extraction, "EXTRACTOR")

        # Tag each extraction with position info
        for item in valid:
            item['line_start'] = chunk['line_start']
            item['line_end'] = chunk['line_end']
            item['position'] = chunk['position']
            item['position_label'] = chunk['position_label']

        all_extractions.extend(valid)
        agent1_raw.append({'chunk': i + 1, 'results': valid})
        print(f"→ {len(valid)} extractions")

    print(f"\n  Total extractions: {len(all_extractions)}")
    mechanisms_count = sum(1 for e in all_extractions if e.get('type') in ('mechanism', 'both'))
    ideas_count = sum(1 for e in all_extractions if e.get('type') in ('idea', 'both'))
    print(f"  Mechanisms: {mechanisms_count}, Ideas: {ideas_count}")
    print()

    # Save Agent 1 output
    agent1_file = out_path / "01_extractor_output.json"
    agent1_file.write_text(json.dumps(agent1_raw, indent=2), encoding='utf-8')
    print(f"  Saved: {agent1_file}")
    print()

    # ============================================================
    # AGENT 2: CHALLENGER
    # ============================================================
    print("=" * 60)
    print("AGENT 2: CHALLENGER")
    print("  Reviewing each chunk for missed details...")
    print("=" * 60)

    all_challenges = []
    agent2_raw = []

    for i, chunk in enumerate(chunks):
        # Get extractions for this chunk
        chunk_extractions = [e for e in all_extractions
                            if e.get('line_start') == chunk['line_start']]

        if not chunk_extractions:
            continue  # nothing to challenge

        print(f"  Chunk {i+1}/{len(chunks)} [L{chunk['line_start']}-{chunk['line_end']}]", end=' ')

        user_msg = f"""ORIGINAL TEXT:
{chunk['text']}

EXTRACTOR FOUND:
{json.dumps(chunk_extractions, indent=2)}

Find what the Extractor missed."""

        results = call_agent(client, model, CHALLENGER_SYSTEM, user_msg, "CHALLENGER")
        valid = validate_and_filter(results, validate_challenge, "CHALLENGER")

        for item in valid:
            item['line_start'] = chunk['line_start']
            item['line_end'] = chunk['line_end']
            item['position_label'] = chunk['position_label']

        all_challenges.extend(valid)
        agent2_raw.append({'chunk': i + 1, 'results': valid})
        print(f"→ {len(valid)} gaps found")

    print(f"\n  Total gaps: {len(all_challenges)}")
    print()

    # Save Agent 2 output
    agent2_file = out_path / "02_challenger_output.json"
    agent2_file.write_text(json.dumps(agent2_raw, indent=2), encoding='utf-8')
    print(f"  Saved: {agent2_file}")
    print()

    # ============================================================
    # AGENT 3: FEASIBILITY
    # ============================================================
    print("=" * 60)
    print("AGENT 3: FEASIBILITY")
    print("  Checking which mechanisms can actually be built...")
    print("=" * 60)

    mechanisms_only = [e for e in all_extractions if e.get('type') in ('mechanism', 'both')]
    all_feasibility = []
    agent3_raw = []

    # Batch mechanisms (send ~5 at a time to reduce API calls)
    batch_size = 5
    for i in range(0, len(mechanisms_only), batch_size):
        batch = mechanisms_only[i:i + batch_size]
        batch_num = i // batch_size + 1
        total_batches = (len(mechanisms_only) + batch_size - 1) // batch_size
        print(f"  Batch {batch_num}/{total_batches} ({len(batch)} mechanisms)", end=' ')

        summaries = [{'summary': m.get('summary', ''), 'exact_quote': m.get('exact_quote', ''),
                       'buildable_claim': m.get('buildable', None),
                       'missing_details': m.get('missing_details', [])} for m in batch]

        user_msg = f"""Check each mechanism for feasibility. Be honest — say what can't work.

MECHANISMS TO CHECK:
{json.dumps(summaries, indent=2)}"""

        results = call_agent(client, model, FEASIBILITY_SYSTEM, user_msg, "FEASIBILITY")
        valid = validate_and_filter(results, validate_feasibility, "FEASIBILITY")

        all_feasibility.extend(valid)
        agent3_raw.append({'batch': batch_num, 'results': valid})
        print(f"→ {len(valid)} checked")

    print(f"\n  Total feasibility checks: {len(all_feasibility)}")

    # Verdict summary
    verdicts = {}
    for f in all_feasibility:
        v = f.get('verdict', 'unknown')
        verdicts[v] = verdicts.get(v, 0) + 1
    for v, count in sorted(verdicts.items(), key=lambda x: -x[1]):
        print(f"    {v}: {count}")
    print()

    # Save Agent 3 output
    agent3_file = out_path / "03_feasibility_output.json"
    agent3_file.write_text(json.dumps(agent3_raw, indent=2), encoding='utf-8')
    print(f"  Saved: {agent3_file}")
    print()

    # ============================================================
    # MERGE INTO TRUTH DOCUMENT (deterministic)
    # ============================================================
    print("=" * 60)
    print("BUILDING TRUTH DOCUMENT")
    print("=" * 60)

    truth = build_truth_document(all_extractions, all_challenges, all_feasibility)
    truth_file = out_path / "TRUTH.txt"
    truth_file.write_text(truth, encoding='utf-8')
    print(f"  Saved: {truth_file}")
    print()

    # Also save a mechanisms-only index for PRD use
    mech_index = build_mechanisms_index(all_extractions, all_feasibility)
    mech_file = out_path / "MECHANISMS_INDEX.txt"
    mech_file.write_text(mech_index, encoding='utf-8')
    print(f"  Saved: {mech_file}")

    # Summary
    print()
    print("=" * 60)
    print("PIPELINE COMPLETE")
    print("=" * 60)
    print(f"  Input: {input_path.name} ({len(lines):,} lines)")
    print(f"  Chunks processed: {len(chunks)}")
    print(f"  Mechanisms found: {mechanisms_count}")
    print(f"  Ideas found: {ideas_count}")
    print(f"  Gaps caught: {len(all_challenges)}")
    print(f"  Feasibility checks: {len(all_feasibility)}")
    print()
    print(f"  Output directory: {out_path}/")
    print(f"    01_extractor_output.json  — What Agent 1 found (inspect per-chunk)")
    print(f"    02_challenger_output.json  — What Agent 2 caught missing (inspect per-chunk)")
    print(f"    03_feasibility_output.json — Agent 3 reality checks (inspect per-batch)")
    print(f"    TRUTH.txt                  — Final merged truth document")
    print(f"    MECHANISMS_INDEX.txt       — Flat mechanisms list for PRD")


def build_mechanisms_index(extractions: list, feasibility: list) -> str:
    """Build a flat mechanisms index grouped by keywords."""
    mechanisms = [e for e in extractions if e.get('type') in ('mechanism', 'both')]

    out = []
    out.append("MECHANISMS INDEX")
    out.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    out.append(f"Total: {len(mechanisms)}")
    out.append("=" * 60)
    out.append("")

    # Group by keywords
    groups = {}
    for mech in mechanisms:
        keywords = mech.get('keywords', [])
        group_key = keywords[0].lower() if keywords else 'uncategorized'
        if group_key not in groups:
            groups[group_key] = []
        groups[group_key].append(mech)

    for group_name, mechs in sorted(groups.items()):
        out.append(f"--- {group_name.upper()} ---")
        for m in mechs:
            buildable = "YES" if m.get('buildable') else "NO"
            out.append(f"  [{buildable}] {m.get('summary', 'N/A')}")
            if m.get('missing_details'):
                for d in m['missing_details']:
                    out.append(f"       needs: {d}")
        out.append("")

    return '\n'.join(out)


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description='PRD Idea Extraction Pipeline — Three-Agent System',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 prd-pipeline.py transcript.txt
  python3 prd-pipeline.py brainstorm.docx --out-dir ./results
  python3 prd-pipeline.py chat.txt --chunk-size 30 --model claude-sonnet-4-20250514

Output files (saved to <input>_pipeline_output/ or --out-dir):
  01_extractor_output.json   — Agent 1: every mechanism and idea found
  02_challenger_output.json  — Agent 2: what Agent 1 missed
  03_feasibility_output.json — Agent 3: what can actually be built
  TRUTH.txt                  — Merged truth document
  MECHANISMS_INDEX.txt       — Flat mechanisms list for PRD building
        """
    )
    parser.add_argument('input', help='Input file (txt, md, or docx)')
    parser.add_argument('--out-dir', help='Output directory (default: <input>_pipeline_output/)')
    parser.add_argument('--chunk-size', type=int, default=DEFAULT_CHUNK_SIZE,
                       help=f'Lines per chunk (default: {DEFAULT_CHUNK_SIZE})')
    parser.add_argument('--model', default=DEFAULT_MODEL,
                       help=f'Claude model to use (default: {DEFAULT_MODEL})')

    args = parser.parse_args()
    run_pipeline(args.input, args.out_dir, args.chunk_size, args.model)


if __name__ == '__main__':
    main()
