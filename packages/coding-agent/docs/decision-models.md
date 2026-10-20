# Decision Models (System One)

Decision models answer typed questions — they do not chat, reason in prose, or generate text. One non-autoregressive scoring pass turns a `state` (text or JSON) plus 1–64 named questions into answers with probabilities: `choice` (pick among described options), `noul` (bare true/false), and `score` (an index on an ordered legend). They are very fast (~150–270 ms typically) and nearly free to run, which makes them the right tool for offloading judgments the agent or the product needs constantly.

a-coder-cli uses them in three places:

1. The `decide` tool — the agent can route a judgment through a decision model instead of burning a full LLM call.
2. The auto-mode permission classifier — when a decision model is available, ambiguous tool calls are gated on `verdict` (allow/block), `risk` (ordinal), and `reversible` (noul). The static-policy heuristics stay first in line; the decision model replaces the LLM classifier only for calls the static rules neither allow nor deny.
3. Smart auto-continue — at a length stop, after compaction, or at a normal pause, a decision model answers `next` (done / ask_user / blocked / continue) and `progress` (noul). The policy continues only when the unfinished-work and progress probabilities clear the configured thresholds, with a consecutive-continuation cap. The model never writes the continuation; it only gates the action.

Local Ollama decision models are discovered from `/api/tags` (`capabilities` includes `decision`), so pulling `nimble-v3`, `tev1`, `pplx-decider`, `strands-decider`, or another decision model makes it available without a catalog release.

## Wire

All hosts speak the System One wire (same request/response shape, `POST` JSON):

| Host | Endpoint | Auth | Models |
|------|----------|------|--------|
| Ollama (local) | `POST {base}/systemone` | none | Discovered from `/api/tags` `capabilities: ["decision"]`: `clef-flash` (9B, vision), `clef`, `nimble`, `nimble-v3`, `tev1`, `pplx-decider`, `strands-decider`, `kev`, `laya` |
| LM Studio (local) | `POST {base}/systemone` | none | local decision models |
| llama.cpp server (local) | `POST {base}/systemone` | none | local decision models |
| Unsloth (local) | `POST {base}/systemone` | none | local decision models |
| TypeSafe (cloud) | `POST https://api.typesafe.ai/v1/systemone` | `TYPESAFE_API_KEY` | `jev-latest`, `jev-1.13` (Jev 1.13: $0.042/M prompt, $0 output) |
| OpenRouter (beta) | `POST https://openrouter.ai/api/alpha/decisions` | `OPENROUTER_API_KEY` | `~typesafe/jev-latest`, `typesafe/jev-1.13` |

Host notes: Ollama caps the request body at 64 KiB without images (the API layer enforces this) and accepts 1–64 named questions (`keep_alive` honored; other hosts ignore unknown fields); images are base64 PNG/JPEG/WebP and require a vision-capable model (Clef); answers are not passed into later questions; every response echoes the served model id, and a response served from a different model family is rejected.

## Setup

Zero-config path: `ollama pull clef-flash` — that's it. The `decide` tool and the auto-mode classifier probe the keyless local servers (Ollama, LM Studio, llama.cpp, Unsloth) once per session and use the first one that answers.

Cloud fallback: `export OPENROUTER_API_KEY=...` enables the Jev beta rows; `export TYPESAFE_API_KEY=...` for TypeSafe direct (early access).

Explicit pick (optional, settings.json):

```json
{
  "decisions": { "provider": "ollama", "model": "clef-flash" }
}
```

`settings.decisions.provider/model` pins the decision model used by the `decide` tool, auto-mode gating, and smart auto-continue unless `autoContinue.provider/model` overrides it. `decide` arguments can override per call.

## The `decide` tool

Read-only and approval-free. Parameters:

- `state` — everything to be judged, as a string or a compact JSON object or array (serialized as text; not chat messages; the model cannot fetch tool results, so summarize what it needs).
- `questions` — 1–16 named questions. Each has `instructions` and, per type:
  - `choice`: `criteria` — `{option: description}` with **2–26 options**; a `null` description lets the option name stand for itself. On ties the winner follows option order, so put the safest/preferred option first.
  - `noul`: optional `criteria` — `{"true": ..., "false": ...}` descriptions. The answer `noul` is the probability the answer is true.
  - `score`: `criteria` — ordered level descriptions, lowest first, numbered from 0 (**2–26 levels**). The answer `score` is the probability-weighted level (fractional), and `legend`/`probabilities` break it down per level.
- Optional `provider`/`model` overrides.

The result card shows each question's answer with the probability bar and confidence; the raw answers JSON is included for downstream use.

`confidence` is how concentrated the answer distribution is — **not** the chance the answer is right. It is displayed but never used to threshold decisions; the classifier gates on the chosen option's probability and the conservative policy instead.

Example questions the model may be asked: "Which route applies to this request?" (choice over your destinations), "Does this error look transient?" (noul), "How far along is the task?" (score with `["not started", "started", "almost", "done"]`).

## Smart auto-continue

Settings:

```json
{
  "decisions": { "provider": "ollama", "model": "nimble-v3" },
  "autoContinue": {
    "mode": "smart",
    "minContinueProbability": 0.7,
    "minProgressProbability": 0.55,
    "maxConsecutive": 2
  }
}
```

Modes:

- `off` — no decision-gated continuation (the legacy one-shot length nudge remains).
- `compaction` — decide after compaction; `compaction.autoContinue` remains the fallback when no model is reachable.
- `smart` — decide after length stops, compaction, and a normal agent pause.

Safety rules:

- A `done` or `blocked` answer stops.
- Low progress stops even if the model is not confident enough to pick `done`.
- The cap and a no-progress gate prevent continuation loops.
- An explicit user abort, pending approval, authentication failure, and failed overflow recovery are never auto-continued.

Every decision emits `auto_continue_decision` with the question probabilities, progress, model, and latency. The CLI shows a status line; the desktop shows a toast and the settings panel exposes the mode/model.

## Auto-mode classifier

`autoMode.enabled` keeps its existing meaning (opt-in) and all circuit breakers (`maxConsecutiveFailures`, `maxConsecutiveBlocks`) apply to both engines. Preference: static policy → decision model (when reachable) → LLM classifier (your session model). A decision-based block degrades to a prompt exactly like the LLM path, and the reason line carries the engine and probability, e.g. `Auto-mode classifier (clef-flash p=0.94): ...`.