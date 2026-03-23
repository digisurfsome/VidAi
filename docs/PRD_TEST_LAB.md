# PRD: Test Lab — Three-Agent Extraction Pipeline

## Overview

Add a new top-level page to the dashboard called **Test Lab** alongside the existing Generate (video) page. This page provides a UI for running a three-agent pipeline that extracts, challenges, and synthesizes ideas from raw conversation transcripts.

The purpose is to test and tune the pipeline mechanism before it becomes a core product feature. Each agent's output is visible independently so the operator can judge quality and adjust.

---

## Context

### What This Is

A Python script (`tools/prd-pipeline.py`) implements a three-agent pipeline using the Claude SDK:

1. **Extractor** — Reads a conversation transcript and pulls out mechanisms, ideas, and concepts. Schema-locked output. No invention, only extraction.
2. **Challenger** — Takes the Extractor's output and stress-tests it. Finds gaps, contradictions, weak points. Its job is to say no.
3. **Synthesizer** — Takes both the Extractor output and Challenger feedback, produces a final structured document with only the ideas that survived.

### Why It Exists

Raw conversation transcripts (5,000–10,000+ lines) contain buried ideas mixed with filler, tangents, and repetition. Running three agents with different roles and control configurations produces better extraction than a single pass.

### Where It Lives

New dashboard page at `/dashboard/test-lab`, accessible via sidebar navigation alongside the existing Generate link.

---

## Tech Stack (Inherited from Boilerplate)

- React 18 + TypeScript + Vite + Tailwind CSS
- shadcn/ui component library
- Supabase (auth, database, storage)
- React Router (routing in `src/App.tsx`)
- Claude SDK via subscription OAuth (see Subscription Auth section)

---

## Requirements

### Page Structure

**Route:** `/dashboard/test-lab`

**Layout:** Vertical tabbed interface (same pattern as SettingsPage / AdminDashboard)

**Left Sidebar Tabs:**
| Tab | Purpose |
|-----|---------|
| **Run Pipeline** | Input form + trigger execution |
| **Extractor Output** | Raw output from Agent 1 |
| **Challenger Output** | Raw output from Agent 2 |
| **Synthesizer Output** | Final merged output from Agent 3 |
| **Run History** | List of previous runs with timestamps |

### Tab 1: Run Pipeline

**Input Section:**
- Large textarea for pasting transcript text (primary input method)
- File upload button accepting `.txt` and `.docx` files
- Character/line count display
- Model selector dropdown (default: `claude-sonnet-4-6`, options: `claude-opus-4-6`, `claude-haiku-4-5`)

**Controls:**
- "Run Pipeline" button — triggers all three agents sequentially
- "Run Extractor Only" button — runs just Agent 1 for quick testing
- Progress indicator showing which agent is currently running (Agent 1 of 3, Agent 2 of 3, Agent 3 of 3)
- Estimated status: queued / extracting / challenging / synthesizing / complete / failed

**Configuration Panel (collapsible):**
- Temperature slider (0.0–1.0, default 0.0 for Extractor/Challenger, 0.3 for Synthesizer)
- Schema strictness toggle (strict / relaxed)
- Max tokens per agent (default: 4096)
- These map to the five control mechanisms being tested

### Tab 2: Extractor Output

- Read-only display of Extractor agent's raw output
- JSON or structured markdown rendering
- Copy-to-clipboard button
- Timestamp of when this output was generated
- Token count / cost indicator

### Tab 3: Challenger Output

- Read-only display of Challenger agent's output
- Shows which extracted items were challenged and why
- Red/yellow/green status indicators per item (rejected / questioned / approved)
- Copy-to-clipboard button

### Tab 4: Synthesizer Output

- Read-only display of final synthesized document
- Clean formatted output (the deliverable)
- Export buttons: Copy, Download as `.md`, Download as `.json`
- Side-by-side diff view option (Extractor original vs Synthesizer final)

### Tab 5: Run History

- Table listing previous runs:
  - Run ID (auto-generated)
  - Timestamp
  - Input source (pasted / filename)
  - Input size (lines/chars)
  - Status (complete / failed / partial)
  - Model used
  - Duration
- Click any row to load that run's outputs into Tabs 2–4
- Delete button per run (with confirmation)
- Runs stored in Supabase table `pipeline_runs`

---

## Data Model

### Table: `pipeline_runs`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | FK to auth.users |
| created_at | timestamptz | Run timestamp |
| status | text | queued / extracting / challenging / synthesizing / complete / failed |
| input_text | text | The raw transcript input |
| input_source | text | 'pasted' or filename |
| input_lines | integer | Line count of input |
| model | text | Claude model used |
| config | jsonb | Temperature, schema mode, max tokens |
| extractor_output | jsonb | Agent 1 raw output |
| challenger_output | jsonb | Agent 2 raw output |
| synthesizer_output | jsonb | Agent 3 final output |
| duration_ms | integer | Total pipeline duration |
| error | text | Error message if failed |

**RLS:** Users can only read/write their own runs. Service role has full access.

---

## API Endpoints

### `POST /api/pipeline/run`

Triggers the three-agent pipeline.

**Request:**
```json
{
  "input_text": "...",
  "input_source": "pasted",
  "model": "claude-sonnet-4-6",
  "config": {
    "extractor_temperature": 0.0,
    "challenger_temperature": 0.0,
    "synthesizer_temperature": 0.3,
    "schema_mode": "strict",
    "max_tokens": 4096
  }
}
```

**Response:** Returns `run_id`. Client polls for status updates.

### `GET /api/pipeline/run/:id`

Returns full run data including all agent outputs.

### `GET /api/pipeline/runs`

Returns paginated list of runs for current user.

### `DELETE /api/pipeline/run/:id`

Deletes a run and its outputs.

---

## Agent Specifications

### Agent 1: Extractor

**System Prompt Core:**
```
You are an extraction agent. Your ONLY job is to identify and extract
mechanisms, ideas, and concepts from the provided conversation transcript.

Rules:
- Extract ONLY what is explicitly stated or clearly implied
- Do NOT invent, suggest, or improve ideas
- Do NOT summarize — extract discrete mechanisms
- Each extracted item must reference the approximate location in the source
- Output must conform to the provided JSON schema exactly
```

**Output Schema:**
```json
{
  "items": [
    {
      "id": "string",
      "title": "string (short name for the mechanism)",
      "description": "string (what it is, in the speaker's framing)",
      "source_quote": "string (exact or near-exact quote from transcript)",
      "category": "mechanism | concept | decision | requirement | question",
      "confidence": "high | medium | low"
    }
  ],
  "metadata": {
    "total_items": "number",
    "input_lines_processed": "number",
    "categories_found": ["string"]
  }
}
```

**Controls:** Temperature 0.0, schema-locked, tool-use-only (output must match schema), no free text.

### Agent 2: Challenger

**System Prompt Core:**
```
You are a challenger agent. Your job is to find problems with extracted items.

For each item, determine:
- Is this actually stated in a transcript, or was it invented by the extractor?
- Is the description accurate to what was said?
- Is this a real mechanism or just a passing comment?
- Are there contradictions between items?
- What's missing that should have been caught?

Your job is to say NO. Default to skepticism. Only approve items that
clearly survive scrutiny.
```

**Output Schema:**
```json
{
  "reviews": [
    {
      "item_id": "string (references extractor item id)",
      "verdict": "approved | questioned | rejected",
      "reason": "string (specific reason for verdict)",
      "suggested_edit": "string | null (if questioned, what should change)"
    }
  ],
  "missing_items": [
    {
      "description": "string (what the extractor missed)",
      "source_hint": "string (where in the transcript to look)"
    }
  ],
  "summary": {
    "approved": "number",
    "questioned": "number",
    "rejected": "number",
    "missing": "number"
  }
}
```

**Controls:** Temperature 0.0, adversarial tone in system prompt, schema-locked output.

### Agent 3: Synthesizer

**System Prompt Core:**
```
You are a synthesis agent. You receive:
1. The Extractor's output (raw extracted items)
2. The Challenger's output (reviews of each item)

Your job:
- Keep items the Challenger approved (unchanged)
- Revise items the Challenger questioned (apply suggested edits)
- Drop items the Challenger rejected
- Add items from the Challenger's "missing" list
- Produce a clean, final document

Do not add your own ideas. Work only with what the two previous agents provided.
```

**Output Schema:**
```json
{
  "final_items": [
    {
      "id": "string",
      "title": "string",
      "description": "string",
      "category": "string",
      "status": "kept | revised | added",
      "revision_note": "string | null"
    }
  ],
  "dropped_items": [
    {
      "original_id": "string",
      "title": "string",
      "drop_reason": "string"
    }
  ],
  "summary": {
    "kept": "number",
    "revised": "number",
    "added": "number",
    "dropped": "number"
  }
}
```

**Controls:** Temperature 0.3, schema-locked output, slight flexibility for synthesis language.

---

## Subscription Auth Integration

All Claude calls MUST use subscription OAuth. Never API keys.

**Python backend (pipeline script):**
```python
from registry import get_effective_sdk_env

sdk_env = get_effective_sdk_env(force_subscription=True)
# Pass sdk_env to ClaudeSDKClient
```

**Bash fallback:**
```bash
unset ANTHROPIC_API_KEY 2>/dev/null || true
claude -p "prompt here"
```

**Verification:** Server logs must show:
```
>>> SUBSCRIPTION AUTH CONFIRMED: ANTHROPIC_API_KEY='', ANTHROPIC_AUTH_TOKEN='' <<<
```

Do NOT:
- Import `anthropic` and create `anthropic.Anthropic(api_key=...)`
- Read `ANTHROPIC_API_KEY` from env
- Add fallback patterns that switch to API key on error

---

## File Changes Required

### New Files

| File | Purpose |
|------|---------|
| `src/pages/TestLabPage.tsx` | Main page component with tabbed interface |
| `src/components/test-lab/RunPipelineTab.tsx` | Input form and execution controls |
| `src/components/test-lab/ExtractorOutputTab.tsx` | Agent 1 output display |
| `src/components/test-lab/ChallengerOutputTab.tsx` | Agent 2 output display |
| `src/components/test-lab/SynthesizerOutputTab.tsx` | Agent 3 output display |
| `src/components/test-lab/RunHistoryTab.tsx` | Previous runs table |
| `src/lib/pipeline.ts` | Client-side API calls for pipeline operations |
| `api/pipeline.ts` | Serverless endpoint for pipeline execution |
| `supabase/migrations/00012_pipeline_runs.sql` | Database migration |

### Modified Files

| File | Change |
|------|--------|
| `src/App.tsx` | Add route: `/dashboard/test-lab` → `TestLabPage` |
| `src/components/Sidebar.tsx` | Add nav link for Test Lab (FlaskConical icon) |

---

## UI/UX Notes

- Follow the exact same vertical tab pattern used in `SettingsPage.tsx` and `AdminDashboard.tsx`
- Left sidebar: 256px width, `TabsList` with `flex-col`
- Right content: `flex-1` with `TabsContent` panels
- Use `PageLayout` wrapper for consistent breadcrumbs
- Progress indicator during pipeline run should use shadcn Badge + animated spinner
- Output displays use `<pre>` blocks with syntax highlighting for JSON, or Card-based layouts for structured data
- Color coding on Challenger verdicts: green (approved), yellow (questioned), red (rejected) using shadcn Badge variants

---

## Scope Boundaries

### In Scope (Build Now)
- Page structure with all 5 tabs
- Input via paste and .txt upload
- Pipeline execution calling three agents sequentially
- Individual output display per agent
- Run history with persistence
- Basic configuration controls

### Out of Scope (Later)
- .docx file parsing (requires additional library)
- Real-time streaming of agent output
- Collaborative/shared runs
- Auto-tuning of control configurations
- Export to external formats beyond .md/.json
- Integration with the main video generation workflow
- Auth/Stripe connection (boilerplate has it, not wiring it yet)

---

## Success Criteria

1. User can paste a 5,000+ line transcript and run the full pipeline
2. Each agent's output is visible in its own tab
3. Challenger output clearly shows which items passed/failed and why
4. Synthesizer output is a clean document with only surviving ideas
5. Previous runs are saved and reloadable
6. All Claude calls use subscription auth ($0 cost)
7. Pipeline completes in under 5 minutes for typical transcripts
