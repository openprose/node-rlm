# Catalog Loading Research: How the Model Learns What It Is

How the component catalog and system context are loaded into agent prompts, where the gaps are, and what to do about them.

---

## 1. Current State: The Prompt Loading Pipeline

### 1.1 From .md files on disk to the system prompt

The pipeline has three entry points that feed into `buildSystemPrompt()`:

**Program loading** (`loadProgram()` in `src/plugins.ts`):

1. Reads all `.md` files in `programs/{name}/`.
2. Classifies by frontmatter:
   - `kind: program` (root.md) -> body becomes `globalDocs`
   - `kind: program-node, role: orchestrator` -> full content (frontmatter included) becomes `rootAppBody`
   - `kind: program-node, other roles` -> full content registered in `childComponents` by both frontmatter name and filename
3. Returns `{ globalDocs, rootApp, rootAppBody, childComponents }`.

**Eval runner wiring** (`eval/run.ts`, `loadAllPlugins()`):

1. If `--program arc3` is specified, `loadProgram("arc3")` is called.
2. `programRootBody` is appended to `pluginBodies` (after any profile drivers).
3. `programGlobalDocs` is merged with benchmark-specific `globalDocs` (e.g., `arc3-global-docs.md`).
4. `programChildComponents` is merged with CLI `--child-component` specs.
5. All of these are passed to `runEval()`, which passes them to `rlm()`.

**System prompt assembly** (`buildSystemPrompt()` in `src/system-prompt.ts`):

Produces 5 sections in order:
1. `<rlm-preamble>` -- what an RLM is, program constructs, composition vocabulary summary
2. `<rlm-environment>` -- sandbox APIs, `rlm()` signature, `__rlm` metadata, shared sandbox explanation, then `## Sandbox Globals` subsection with `globalDocs` content, then `## Available Models` table
3. `<rlm-context>` -- agent identity, depth, budget, delegation capability
4. `<rlm-rules>` -- 6 behavioral rules
5. `<rlm-program>` -- the agent's own program content (only if present)

### 1.2 What each depth level actually sees

**Depth 0 (root orchestrator, e.g., `arc3-game-solver`)**:

| Section | Content |
|---------|---------|
| `<rlm-preamble>` | Generic RLM description, program construct summary |
| `<rlm-environment>` | Full env (with `rlm()` docs) + `globalDocs` (root.md body = component catalog + state schemas + composition vocabulary + composition principles + arc3 API reference) + model table |
| `<rlm-context>` | "root orchestrator", depth 0/3, delegation depth info |
| `<rlm-rules>` | 6 rules |
| `<rlm-program>` | Driver bodies (if any profile matched) + `---` + game-solver.md full content (frontmatter + body) |

**Depth 1 (coordinator, e.g., `arc3-level-solver`)**:

| Section | Content |
|---------|---------|
| `<rlm-preamble>` | Same as depth 0 |
| `<rlm-environment>` | Full env (with `rlm()` docs) + **same `globalDocs`** + model table |
| `<rlm-context>` | Parent ID, depth 1/3, delegation depth info |
| `<rlm-rules>` | Same 6 rules |
| `<rlm-program>` | level-solver.md full content (frontmatter + body) |

**Depth 2 (leaf, e.g., `arc3-oha`)**:

| Section | Content |
|---------|---------|
| `<rlm-preamble>` | Same as depth 0 |
| `<rlm-environment>` | Env **without** `rlm()` docs (canDelegate=false) + **same `globalDocs`** + **no model table** |
| `<rlm-context>` | Parent ID, depth 2/3, "cannot spawn child agents" |
| `<rlm-rules>` | Same 6 rules |
| `<rlm-program>` | oha.md full content (frontmatter + body) |

**Key observation**: `globalDocs` is identical at all depths. The leaf agent sees the full component catalog, composition vocabulary, and composition principles -- even though it cannot delegate.

### 1.3 What differs vs what is shared

| Content | Shared across depths? | Notes |
|---------|----------------------|-------|
| `<rlm-preamble>` | Yes, identical | Same 18-line paragraph for everyone |
| `<rlm-environment>` core | Mostly -- `rlm()` docs only when canDelegate | |
| `globalDocs` (root.md body) | Yes, identical | Full component catalog at every depth |
| Model table | Only when canDelegate | |
| `<rlm-context>` | No -- depth, parent, budget all differ | |
| `<rlm-rules>` | Yes, identical | |
| `<rlm-program>` | No -- each agent gets its own node file | Root gets pluginBodies + orchestrator node |

### 1.4 Token cost estimates

Using the rough heuristic of 1 token per 4 characters:

| Content | Bytes | Est. tokens |
|---------|-------|-------------|
| `<rlm-preamble>` | ~1,800 | ~450 |
| `<rlm-environment>` (with rlm docs, no globalDocs) | ~1,500 | ~375 |
| `<rlm-rules>` | ~500 | ~125 |
| `<rlm-context>` | ~300 | ~75 |
| **Subtotal: fixed system prompt** | **~4,100** | **~1,025** |
| arc3 root.md body (globalDocs) | 10,479 | ~2,620 |
| arc3 API reference (arc3-global-docs.md) | 2,128 | ~530 |
| **Subtotal: globalDocs** | **~12,600** | **~3,150** |
| game-solver.md | 7,537 | ~1,885 |
| level-solver.md | 7,928 | ~1,980 |
| oha.md | 8,652 | ~2,165 |
| **Total depth 0 system prompt** | **~24,237** | **~6,060** |
| **Total depth 1 system prompt** | **~24,628** | **~6,160** |
| **Total depth 2 system prompt** | **~23,452** | **~5,865** |

For context on the stdlib:

| Content | Bytes | Est. tokens |
|---------|-------|-------------|
| All lib/composites/ (7 files) | 19,518 | ~4,880 |
| All lib/controls/ (5 files) | 12,950 | ~3,240 |
| All lib/roles/ (5 files) | 7,716 | ~1,930 |
| **Total stdlib (17 components)** | **40,184** | **~10,050** |
| TENETS.md | 3,601 | ~900 |
| CONTAINER.md | 16,332 | ~4,085 |
| LANGUAGE.md | 17,311 | ~4,330 |
| BACKPRESSURE.md | 9,046 | ~2,260 |
| **Total design docs** | **46,290** | **~11,575** |

---

## 2. Gaps Identified

### 2.1 The model does not know the RLM paradigm

The `<rlm-preamble>` is the model's only introduction to what it is. It is 18 lines long. It mentions:

- That it is a recursive language model (one sentence)
- That it writes JavaScript via execute_code (one sentence)
- That programs use contracts, state schemas, delegation patterns (bullet list)
- That composition vocabulary exists (one bullet)
- That briefs are interfaces (one bullet)

What it does NOT mention:

- **Why** contracts over procedures (the model-upgrade-proof principle)
- **Why** multi-polarity matters (the structural error correction argument)
- **Why** collapse is dangerous (the default failure mode)
- **Why** the sandbox is the only tool (no tool-calling paradigm)
- **Why** the model should trust itself rather than wait for guardrails
- The concept of the model as an intelligent container
- That the composition vocabulary is a seed, not a cage

The preamble teaches the WHAT but not the WHY. The model follows its program by instruction-following, not by understanding why the program is designed that way. When the program is ambiguous or novel situations arise, the model has no design principles to fall back on.

### 2.2 The composition vocabulary is mentioned but not taught

The preamble says: "Composition vocabulary: named composition styles (e.g. `direct`, `coordinated`). Select based on observable state." This is a single bullet point.

The full explanation of what these styles are, when to use them, and how they compose (topology axis vs brief richness axis) lives in root.md's globalDocs. So the model at depth 0 DOES see the full vocabulary. But the preamble summary is so terse that if globalDocs were absent, the model would have no operational understanding of the vocabulary.

**The gap is dependency**: the preamble references concepts that only become concrete through root.md content. If a program's root.md does not include the composition vocabulary section, the model is told to "select from the composition vocabulary" without knowing what that means.

### 2.3 The stdlib is invisible

The 17 standard library components are completely absent from the model's prompt. No agent at any depth currently sees:

- That `worker-critic`, `ratchet`, `map-reduce`, etc. exist
- That composites have slot-based configuration via `&compositeState` / `&controlState`
- That roles like `critic`, `verifier`, `summarizer` can fill composite slots
- That controls like `retry-with-learning` or `gate` wrap other components

The stdlib lives in `lib/` but nothing in the loading pipeline reads those files unless they are explicitly registered. The `loadProgram()` function only reads files from `programs/{name}/`. The `loadStack()` function reads from `lib/drivers/` and `lib/profiles/` but not from `lib/composites/`, `lib/controls/`, or `lib/roles/`.

For the stdlib to be usable, a composing agent would need to:
1. Know which components exist (catalog)
2. Know which are registered in `childComponents` for the current run
3. Know the slot-filling convention (`&compositeState.worker = "critic"`)

Currently none of these three things happen automatically.

### 2.4 No agent knows about `&compositeState` / `&controlState`

The slot-filling convention for stdlib composites uses `&compositeState` (for composites) and `&controlState` (for controls). These state variables are documented inside each lib component's `.md` file, but since those files are never loaded into any prompt, no agent knows this convention exists.

Even if a component were registered via `--child-component worker-critic`, the PARENT that needs to set up `&compositeState` before delegating would not know the convention unless its own program told it. The child (the composite) would know from its own program, but the parent-child contract negotiation is currently one-sided.

### 2.5 Leaf agents see composition content they cannot use

At depth 2 (leaf, maxDepth=3), the OHA agent sees the full `globalDocs`: component catalog, composition vocabulary, composition principles. It cannot delegate. This is ~2,620 tokens of content that is irrelevant to its task.

For the current arc3 program with 3 components, this waste is moderate. But if globalDocs were expanded with stdlib catalog entries for 17+ components, the waste would grow to ~5,000-8,000 tokens per leaf invocation.

### 2.6 `<rlm-rules>` is thin

The rules section is 6 lines:
1. One tool call per response
2. Verify before returning
3. Always await rlm()
4. Observable progress each iteration
5. Read errors and adapt
6. Never return unverified values

These are all behavioral mechanics. There are no rules about:
- Delegation discipline (brief construction from state, not analysis)
- Curation obligation (curate after every delegation)
- Shape adherence (respect prohibited, delegate what belongs to children)
- Multi-polarity (don't self-check; use structural tension)

These ARE covered in program-specific content (game-solver.md, root.md), but they are not universal rules. A model running without a program gets zero guidance on these.

### 2.7 The preamble conflates instruction and philosophy

The preamble tries to be both "here is what you are" and "here is how programs work." These are different concerns. The first is identity/philosophy that applies always. The second is syntax reference that applies when a program is present. Interleaving them means the philosophy is diluted and the syntax reference is incomplete.

---

## 3. Proposals

### Proposal A: Distilled philosophy injection

Create a new section `<rlm-philosophy>` between `<rlm-preamble>` and `<rlm-environment>` that contains a distilled version of the key principles from TENETS.md and CONTAINER.md. Not the full documents -- a hand-crafted ~500-token distillation.

**Content** (draft):

```
<rlm-philosophy>
You are a general-purpose computer, not a chatbot. You run programs by reading prose
and writing code. There is no tool use -- the sandbox IS the tool.

Trust yourself. Push complexity into your reasoning, not into the engine.
Every guardrail hardcoded in the runtime is a bet against model improvement.
You handle ambiguity, error recovery, planning, and judgment.

Multi-polarity is structural error correction. A single agent rationalizes its
own mistakes. Two or three agents with distinct roles create adversarial tension
that catches errors no single agent would notice. The minimum viable
multi-polarity is 2.

The composition vocabulary (direct, coordinated, exploratory, targeted) is a seed,
not a cage. If you discover an effective pattern not in the vocabulary, use it.
Ground composition decisions in observable state: budget remaining, knowledge
completeness, retry count, depth headroom.

Curation is the return on composition. If you delegate without curating the
return, the delegation's value is zero. Collapse (absorbing your children's work)
is the default failure mode.
</rlm-philosophy>
```

**Estimated cost**: ~200 tokens

**Trade-offs**:
- Pro: Every agent gets the WHY, not just the WHAT
- Pro: Cheap -- 200 tokens is negligible
- Pro: Improves behavior even without a program
- Con: Hand-crafted, so it may drift from the source documents
- Con: Another section to maintain

### Proposal B: Depth-filtered globalDocs

Split `globalDocs` into two sections:

1. **Universal globalDocs**: state schemas, shared API reference (always included)
2. **Composition globalDocs**: component catalog, composition vocabulary, composition principles (only when `canDelegate` is true)

In `buildSystemPrompt()`, only include the composition portion when the agent can delegate.

**Implementation approach**: Instead of a single `globalDocs` string, accept `globalDocs: { universal: string, composition?: string }` or use a convention like `<!-- COMPOSITION_ONLY_BELOW -->` marker in root.md.

Simpler approach: the loader can split root.md body at a known heading (e.g., `## Components` marks the start of composition content, everything before it is universal).

**Estimated savings**: For arc3, the component catalog + composition vocabulary + composition principles is roughly 5,500 bytes (~1,375 tokens) that leaf agents would no longer see.

**Trade-offs**:
- Pro: Reduces leaf token waste
- Pro: Reduces distraction -- leaf agents see only what they need
- Con: Adds complexity to the loading pipeline
- Con: Requires convention or markup in root.md
- Con: A leaf agent that encounters something unexpected cannot reason about the composition context (though it arguably should not need to)

### Proposal C: Stdlib catalog summary in globalDocs

Add a lightweight summary of available stdlib components to `globalDocs`. Not the full component files, but a catalog reference:

```markdown
## Standard Library Components

Available for delegation via `rlm(brief, null, { use: "component-name" })`.
Set up `&compositeState` or `&controlState` before delegating to composites/controls.

### Composites (multi-agent patterns)
- **worker-critic**: Work, evaluate, retry. Slots: worker, critic
- **ratchet**: Advance and certify; certified progress is never rolled back. Slots: advancer, ratchet
- **dialectic**: Thesis and antithesis argue; disagreement IS the output. Slots: thesis, antithesis
- **witness**: Two agents independently observe same data. Slots: witness_a, witness_b
- **proposer-adversary**: Propose, then attack. Slots: proposer, adversary
- **ensemble-synthesizer**: K agents work, synthesizer merges. Slots: ensemble_member, synthesizer
- **observer-actor-arbiter**: Act, observe, arbitrate. Slots: actor, observer, arbiter

### Roles (single-agent, fill composite slots)
- **critic**: Evaluate result against criteria; accept/reject
- **verifier**: Check result against formal constraints
- **summarizer**: Compress context preserving key information
- **classifier**: Categorize given categories and criteria
- **extractor**: Pull structured data from unstructured input

### Controls (delegation flow)
- **retry-with-learning**: Retry with failure analysis
- **progressive-refinement**: Iteratively improve until threshold
- **map-reduce**: Split, delegate chunks, merge
- **pipeline**: Sequential transformation stages
- **gate**: Check before delegating; fail-fast
```

**Estimated cost**: ~600 tokens

**Trade-offs**:
- Pro: Every delegating agent knows what stdlib offers
- Pro: Enables emergent composition -- a model might choose worker-critic for a subtask even if the program doesn't prescribe it
- Pro: Lightweight -- 600 tokens is acceptable
- Con: Only useful if the components are actually registered in `childComponents`
- Con: Model might try to use components that aren't registered, producing errors
- Con: Adds token cost at every depth (mitigated by Proposal B)

### Proposal D: Load TENETS/CONTAINER/LANGUAGE directly

Load the full text of TENETS.md, CONTAINER.md, and LANGUAGE.md into the system prompt.

**Estimated cost**: ~9,315 tokens (TENETS ~900, CONTAINER ~4,085, LANGUAGE ~4,330)

**Trade-offs**:
- Pro: Model gets the complete unabridged philosophy
- Pro: No lossy hand-crafted summary to maintain
- Pro: LANGUAGE.md serves as a complete syntax reference for program constructs
- Con: ~9,300 tokens is expensive -- added at EVERY depth, EVERY invocation
- Con: Much of the content is design rationale for humans, not actionable for the model
- Con: CONTAINER.md's Spring/Erlang analogies are meta-context that may confuse rather than help
- Con: BACKPRESSURE.md is about the judge system, not relevant to executing agents
- Con: Context pollution -- the model may over-attend to philosophy and under-attend to its program

### Proposal E: On-demand philosophy via a sandbox helper

Instead of putting documents in the prompt, expose them as a sandbox function:

```javascript
__docs.read("TENETS")     // returns the text of TENETS.md
__docs.read("CONTAINER")  // returns the text of CONTAINER.md
__docs.search("composition vocabulary")  // returns relevant excerpts
```

The agent can choose to read design documents when needed.

**Trade-offs**:
- Pro: Zero prompt cost unless the agent decides it needs it
- Pro: Complete documents available on demand
- Pro: Progressive disclosure -- agent pulls what it needs
- Con: Burns an iteration to read documents
- Con: Agent might never read them if not prompted to
- Con: Adds engine complexity (new sandbox global, document loading)
- Con: The agent needs to know the documents exist, which requires prompt space anyway

### Proposal F: Enriched `<rlm-rules>` with delegation discipline

Expand `<rlm-rules>` from 6 lines to ~12 lines, adding delegation discipline rules that are currently only in program-specific content:

```
- Delegation briefs must be constructed from &-state, not from your own analysis.
- Curate after EVERY delegation return -- this is not optional.
- If your program says prohibited: [X], calling X is a shape violation.
- If you skip a coordinator (direct composition), you inherit its responsibilities.
- Multi-step action sequences belong to leaf agents, not coordinators.
- Two agents are more robust than one -- structural tension catches rationalization.
```

**Estimated cost**: ~100 tokens additional

**Trade-offs**:
- Pro: Delegation rules become universal, not program-dependent
- Pro: Cheap
- Con: Some rules only apply when delegating (could be gated on `canDelegate`)
- Con: Rules without a program to ground them may be abstract

### Proposal G: Auto-register stdlib components

Modify `loadProgram()` (or add a new loader step) to automatically register all `lib/composites/`, `lib/controls/`, and `lib/roles/` files in `childComponents`, so they are available for delegation without explicit `--child-component` flags.

**Trade-offs**:
- Pro: Stdlib is available out of the box
- Pro: Combined with Proposal C, the model both knows about and can use stdlib
- Con: All 17 components registered means 17 entries in the flat dictionary
- Con: Namespace collision risk with program-local components
- Con: Not all components are relevant to all programs
- Con: Program-local overrides of stdlib names need clear precedence rules

---

## 4. Recommended Approach

A phased approach, combining proposals A + B + C + F:

### Phase 1: Philosophy and rules enrichment (Proposals A + F)

Add `<rlm-philosophy>` (~200 tokens) and expand `<rlm-rules>` (~100 tokens). Total cost: ~300 tokens per invocation. This addresses the fundamental gap: the model understands WHAT to do but not WHY.

This is cheap, high-value, and requires changes only to `src/system-prompt.ts`. No loader changes. No new loading pipeline.

**Implementation**:
- Add `<rlm-philosophy>` section to `buildSystemPrompt()` between preamble and environment
- Add delegation discipline rules to `<rlm-rules>`, gated on `canDelegate`

### Phase 2: Depth-filtered globalDocs (Proposal B)

Add a mechanism to split globalDocs into universal and composition-only content. The simplest approach: `buildSystemPrompt()` accepts both `globalDocs` (always) and `compositionDocs` (only when `canDelegate`).

The program loader (`loadProgram()`) would need a convention for marking the split point in root.md. A practical convention: everything above the `## Components` heading is universal; the heading and below is composition-only.

**Implementation**:
- `loadProgram()` splits root.md body at a known heading
- `BuildSystemPromptOptions` gains a `compositionDocs?: string` field
- `buildSystemPrompt()` includes `compositionDocs` only when `canDelegate`

### Phase 3: Stdlib catalog injection (Proposal C + partial G)

Add a lightweight stdlib catalog summary to globalDocs (Proposal C). Combined with Phase 2, this catalog only appears for delegating agents.

For auto-registration (Proposal G), use an opt-in approach: `loadProgram()` gains an option like `{ includeStdlib: true }` that also scans `lib/composites/`, `lib/controls/`, `lib/roles/` and adds them to `childComponents`. Programs can then choose whether to make the stdlib available.

**Implementation**:
- Create a stdlib catalog summary document (static .md file or generated from frontmatter)
- Auto-registration as opt-in in `loadProgram()`
- Catalog summary appears in compositionDocs (only for delegating agents)

### Phase 4 (deferred): On-demand design documents

If Phase 1's distilled philosophy proves insufficient, consider Proposal E (sandbox helper for full documents). But this should be a response to observed problems, not speculative.

### What NOT to do

- Do NOT load TENETS.md, CONTAINER.md, LANGUAGE.md in full (Proposal D). The token cost (~9,300 per invocation) is disproportionate to the value, and much of the content is human-facing rationale, not model-actionable guidance. A 200-token distillation captures the operational essence.

- Do NOT put the full stdlib component files in the prompt. 17 files at ~10,050 tokens is too much. A 600-token catalog summary is sufficient for discovery; the full component spec loads when `{ use: "worker-critic" }` is called.

---

## 5. Specific Knowledge Gaps Analysis

Answers to the specific questions from the investigation brief:

### Does the model know about the composition vocabulary?

**Partially.** The `<rlm-preamble>` mentions it in one bullet point. If the program's root.md includes a `## Composition Vocabulary` section (as arc3's does), the model sees the full vocabulary in `globalDocs`. But without a program, the model has only a vague reference.

**Recommendation**: Phase 1's `<rlm-philosophy>` section names the four styles and their axes. This provides baseline understanding even without a program.

### Does the model know about multi-polarity and why it matters?

**No.** The preamble does not mention multi-polarity. The rules do not mention it. Only TENETS.md and CONTAINER.md discuss it. The model has zero exposure to this concept unless the program explicitly teaches it.

**Recommendation**: Phase 1's `<rlm-philosophy>` section includes the structural error correction argument in 2 sentences.

### Does the model know about slot-filling for stdlib composites?

**No.** The `&compositeState` / `&controlState` convention is documented only inside the lib component files, which are never loaded into prompts unless explicitly registered. No agent currently knows this convention exists.

**Recommendation**: Phase 3's stdlib catalog summary includes a one-liner about the convention: "Set up `&compositeState` or `&controlState` before delegating to composites/controls."

### Does the model know about `&compositeState` / `&controlState`?

**No.** Same as above. These are library-internal conventions with no exposure to composing agents.

### Does the model know it can discover new patterns beyond the named vocabulary?

**Only if the program says so.** The arc3 root.md does not explicitly say this. CONTAINER.md says: "the hand-designed vocabulary is a seed: useful for bootstrapping because current models aren't reliable at meta-reasoning about composition from scratch, but the long-term move is to let effective patterns emerge from traces rather than from intuitions." The model never sees this.

**Recommendation**: Phase 1's `<rlm-philosophy>` section states: "The composition vocabulary is a seed, not a cage. If you discover an effective pattern not in the vocabulary, use it."

---

## 6. Loading Static Files: Evaluation

The user suggested loading TENETS.md, CONTAINER.md, LANGUAGE.md into the prompt.

### What would be gained

- **Complete design philosophy**: The model would understand WHY the system is designed the way it is, not just WHAT to do. This is the difference between instruction-following and genuine understanding.
- **LANGUAGE.md as syntax reference**: The syntax reference section of LANGUAGE.md is genuinely useful as a reference for how to read program constructs (`ensures:`, `requires:`, `shape:`, `given:`, strategies, etc.)
- **No maintenance gap**: The documents are the source of truth. A distilled summary can drift.

### What would be lost

- **~9,300 tokens per invocation at every depth**: For a typical arc3 run with maxDepth=3 and 7 levels, there might be ~50+ invocations. That is ~465,000 extra input tokens per run. At $3/M input tokens (Sonnet pricing), that is ~$1.40 per run. At Opus pricing ($15/M), ~$7 per run.
- **Attention dilution**: CONTAINER.md's Spring/Erlang analogies, while illuminating for humans, may actively confuse the model. The section "What Is Not Implemented Yet" lists features that do not exist -- the model might try to use them.
- **BACKPRESSURE.md is irrelevant**: It describes the judge system, which executing agents never interact with.

### Recommended trade-off

Load a **distilled version** (Proposal A, ~200 tokens) rather than the full documents (~9,300 tokens). The distillation captures the 5 operational principles the model needs:

1. You are a computer, not a chatbot
2. Trust yourself
3. Multi-polarity is structural error correction
4. The composition vocabulary is a seed
5. Curation is the return on composition

If there is evidence that the 200-token distillation is insufficient (observable from traces where the model makes philosophy-violating decisions), then progressively add:
- TENETS.md (~900 tokens) -- the most information-dense and action-oriented document
- The "Syntax Reference" section of LANGUAGE.md (~2,000 tokens) -- genuine reference material
- NOT the full CONTAINER.md or BACKPRESSURE.md -- these are design rationale documents, not operating instructions

### What about auto-generating a distilled version?

Possible but introduces a maintenance step. The philosophy documents change infrequently. A hand-crafted 200-token distillation reviewed whenever the source documents change is simpler and more reliable than an auto-generation pipeline. The distillation should be stored as a dedicated file (e.g., `lib/philosophy.md` or inline in `system-prompt.ts`) with comments pointing to the source documents.

---

## 7. Token Budget Summary

Current arc3 system prompt cost per invocation:

| Agent | Current tokens | With Phase 1 (+A,F) | With Phase 2 (+B) | With Phase 3 (+C) |
|-------|---------------|---------------------|-------------------|-------------------|
| Depth 0 (orchestrator) | ~6,060 | ~6,360 | ~6,360 | ~6,960 |
| Depth 1 (coordinator) | ~6,160 | ~6,460 | ~6,460 | ~7,060 |
| Depth 2 (leaf) | ~5,865 | ~6,165 | **~4,790** (-1,375) | ~4,790 |

Phase 2 saves ~1,375 tokens per leaf invocation by removing composition content. Phase 3 adds ~600 tokens of stdlib catalog to delegating agents. Net effect:

- Delegating agents: +300 (philosophy) + 600 (stdlib catalog) = +900 tokens
- Leaf agents: +300 (philosophy) - 1,375 (no composition docs) = -1,075 tokens

For a typical arc3 run (~15 leaf invocations, ~5 coordinator invocations, ~1 orchestrator invocation), the net change is: `(1 * 900) + (5 * 900) + (15 * -1,075)` = 900 + 4,500 - 16,125 = **-10,725 tokens saved** per run.
