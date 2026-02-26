# The Container Model

The model is the container. There is no container runtime. The RLM reads a program, sees a component catalog, and composes other RLMs. Every delegating agent is itself a container for its subtree. The engine loads text and injects it into prompts. Everything else -- composition reasoning, topology decisions, delegation discipline, knowledge curation -- is the model reading prose and writing code.

## What the Container Is

In classical IoC, the container is infrastructure: a runtime that reads a configuration, instantiates beans, and wires dependencies at startup. In node-rlm, the container is intelligence. The LLM at each depth reads the component catalog (from `root.md`, injected as `globalDocs`), reads its own program (the node file), and decides how to compose its subtree based on the current situation.

There is no startup wiring phase. There is no container lifecycle. The root RLM instance IS the container. When it calls `rlm(brief, null, { app: "level-solver" })`, it is making a composition decision -- selecting a component, satisfying its requirements, and delegating work. The child RLM is another container. It sees the same component catalog, makes its own composition decisions, and delegates further or acts as a leaf.

The whole system is RLMs reading programs and composing other RLMs. There is nothing else.

## How It Diverges from Classical IoC

Classical IoC has a single top-level container that pre-wires the entire object graph at startup. Components receive their dependencies; they do not choose them. The wiring is static, inspectable before runtime, and fails fast on misconfiguration.

Node-rlm diverges in three ways:

**Distributed composition.** Every delegating agent is a container for its children. The childApps dictionary is flat and global -- all components are visible at all depths. GameSolver could delegate directly to OHA. LevelSolver could skip delegation entirely. The hierarchy emerges from runtime decisions, not from a wiring specification.

**Runtime topology decisions.** Composition adapts to the situation. A level with confirmed mechanics may use fewer tiers than a discovery level. A retry may use a different topology than the first attempt. The model observes state and selects composition style accordingly.

**No startup wiring phase.** Wiring happens continuously, at every delegation point, throughout execution. Each delegation is a fresh composition decision informed by accumulated state.

### Pitfalls and Mitigations

Diverging from classical IoC introduces concrete risks:

1. **No global consistency arbiter.** When an agent skips a coordinator and delegates directly to a leaf, nobody satisfies the coordinator's responsibilities (state initialization, key_findings extraction). Mitigation: each component declares explicit `requires from caller` / `produces for caller` contracts. Any composing agent reads the contract and inherits the skipped component's responsibilities.

2. **Ephemeral topology.** The wiring only exists in the trace -- you cannot inspect it before runtime. Mitigation: composition decisions are logged as first-class trace data. The model logs what it chose and why.

3. **Cascading failures are slow and expensive.** A contaminated brief at depth 0 burns hundreds of actions at depth 2 before anyone intervenes. Mitigation: budget proportionality -- do not compose deep subtrees on thin budgets.

4. **State schemas coupled to topology.** `&LevelState.key_findings` is a coordinator-to-orchestrator contract. Skip the coordinator and it breaks silently. Mitigation: the `does NOT produce` field in the component catalog makes these gaps explicit. The composing agent sees what it must handle itself.

5. **Collapse is the default failure mode.** Without deliberate effort, agents absorb their children's work. A coordinator that "just takes a few actions to test" will take a hundred. Mitigation: composition principles make collapse a named anti-pattern with observable symptoms.

6. **Compositional reasoning is harder than behavioral reasoning.** The training signal for "when to introduce an intermediary" is sparse. Mitigation: ground composition decisions in observable state (budget, knowledge completeness, retry count, depth headroom) rather than abstractions like "cognitive distance."

## The Composition Vocabulary

Agents select from a small set of named composition styles when delegating. These are the equivalent of Erlang/OTP supervision strategies -- a bounded vocabulary of structural decisions that makes composition reasoning tractable.

The vocabulary has two orthogonal axes:

**Topology** (how deep is the subtree):
- **direct** -- delegate straight to a leaf component. Use when the task is well-understood, budget is thin, or mechanics are confirmed. The caller must satisfy the leaf's `requires from caller` directly.
- **coordinated** -- interpose a coordinator between yourself and the leaf. Use when discovery is needed, multiple strategy cycles are expected, or stuck-detection matters. The caller satisfies the coordinator's requirements; the coordinator handles the leaf's.

**Brief richness** (how much context to pass):
- **exploratory** -- delegate with minimal brief. Let the child discover. Use on first encounter or when prior knowledge might contaminate. Combines with direct or coordinated.
- **targeted** -- delegate with rich brief constructed from confirmed `&`-state. Use when retrying with accumulated knowledge. Combines with direct or coordinated.

These are composable. A `coordinated + exploratory` delegation interposes a coordinator and lets the child discover. A `direct + targeted` delegation goes straight to a leaf with rich context. The vocabulary is small enough that the model can reason about it reliably.

## Composition Principles

Six invariants govern when and how to compose, regardless of which components are selected.

**Curation is the return on composition.** A flat architecture (one agent does everything) is simpler. A composed architecture only pays off if knowledge flows upward after each delegation. If you delegate without curating the return, you paid the cost of composition without getting the benefit. Better to not delegate at all.

**Collapse is the default failure mode.** Without deliberate effort, agents absorb their children's work. Delegation is a commitment to abstraction separation. Partial delegation -- taking some actions, delegating others -- is worse than no delegation. It combines the overhead of composition with the blindness of direct action. Observable symptom: if you called a function listed in your `prohibited:` field, you have collapsed.

**Budget proportionality.** Match composition depth to remaining budgets. Thin budgets and shallow depth headroom call for direct composition. Rich budgets and deep headroom justify coordinated composition. If a prior composition failed structurally, try a different style.

**Satisfy requires before delegating.** Before calling `rlm()` with a component, check its `requires from caller` contract. If you skip a coordinator (direct style), you inherit its responsibilities -- initializing state, setting strategy, extracting findings after the child returns.

**Briefs are interfaces.** When you delegate, pass the child facts from `&`-state -- not your own analysis. Your analysis is at the wrong level of abstraction for the child. The child has its own program that teaches it how to observe and act. The brief provides context; the program provides methodology. A brief contains goals, confirmed knowledge, open questions, and retry context. A brief never contains action instructions, domain interpretation, or tactical advice.

**Tension is structural error correction.** A single agent rationalizes its own mistakes -- it cannot be both actor and critic. Two or three agents with distinct roles (observer/actor, delegator/curator, target/oversight) create adversarial-like tension that catches errors no single agent would notice. This is the structural argument for composition beyond efficiency: a 2-agent composite is more robust than a 1-agent monolith, not because it does more work, but because it can disagree with itself.

## How Components Are Made Legible

The component catalog lives in `root.md`, whose body becomes `globalDocs`. `globalDocs` appears inside `<rlm-environment>` at every depth. Every agent -- root, coordinator, leaf -- sees the full catalog.

Each component in the catalog declares:
- **role**: orchestrator, coordinator, or leaf
- **app**: the name used in `rlm()` calls (e.g., `{ app: "level-solver" }`)
- **good at / bad at**: what the component does well and poorly
- **requires from caller**: preconditions the composing agent must satisfy
- **produces for caller**: what the composing agent can expect after delegation
- **does NOT produce**: responsibilities the composing agent must handle itself
- **state reads/writes**: which `&`-state variables the component touches

This is not a wiring diagram. It is a decision-support document. The model reads the catalog, matches component capabilities to the current situation, and composes. For a simple level with confirmed mechanics, it might delegate directly to a leaf. For a complex discovery level, it might use the full multi-tier chain.

## The root.md File

`root.md` is the composition root -- the analog of Spring's `applicationContext.xml`. It has `kind: program` in its frontmatter. Its body contains:

1. **Component catalog** with `requires`/`produces`/`does NOT produce` contracts
2. **Shared state schemas** (`&GameKnowledge`, `&LevelState`)
3. **Composition vocabulary** (direct, coordinated, exploratory, targeted)
4. **Composition principles** (curation, collapse, budget, requires, briefs)

The body becomes `globalDocs`, which is injected into `<rlm-environment>` at every depth. This is the only special treatment `root.md` receives -- its content goes to all depths instead of one. The loader also uses its presence to discover the orchestrator and child apps.

The name `root.md` communicates its role: the top of the composition tree, distinct from the node files that describe individual components.

## The Program Loading Pipeline

`loadProgram()` in `src/plugins.ts` reads `programs/{name}/` and classifies files by frontmatter:

1. **`kind: program`** (root.md): body becomes `globalDocs`. Visible at all depths via `<rlm-environment>`.
2. **`kind: program-node`, `role: orchestrator`**: full content (including frontmatter) becomes `rootAppBody`. This is the root agent's `<rlm-program>`.
3. **`kind: program-node`, other roles**: full content (including frontmatter) registered in `childApps` under both the frontmatter `name` (e.g., `arc3-level-solver`) and the short filename (e.g., `level-solver`).

The flat `childApps` dictionary means any agent at any depth can compose any component by name. The hierarchy is enforced by prose (composition principles in `root.md` and `shape:` declarations in node files), not by code. This is deliberate: the model is the container, and the container makes topology decisions at runtime.

When an agent calls `rlm(brief, null, { app: "oha" })`, the engine does a direct `childApps["oha"]` lookup, loads that node's full content as the child's `<rlm-program>`, and starts a new RLM loop. The child sees the same `globalDocs` (component catalog, state schemas, composition principles) but a different program (its own node file).

## Depth Awareness

Every agent sees its position in the delegation tree:

- **`__rlm.depth`** and **`__rlm.maxDepth`**: injected into the sandbox at every depth as a frozen object (`rlm.ts`).
- **`<rlm-context>`**: the system prompt says `Agent "X" -- depth N of M (0-indexed)` plus delegation capability and remaining delegation depth (`Remaining delegation depth: K level(s) below you.`).

Agents reason about depth budget when composing. If `maxDepth - depth - 1 < 2`, coordinated composition is not justified because the coordinator's children would be at maximum depth. The composition vocabulary's budget proportionality principle makes this explicit.

## The Spring Analogy

Where it maps:

| Spring | node-rlm |
|--------|----------|
| `applicationContext.xml` | `root.md` -- declares components, state schemas, composition principles |
| Bean classes (`@Component`) | Node `.md` files -- self-describe via frontmatter (role, delegates, prohibited, state) |
| `@Autowired` | `{ app: "name" }` in `rlm()` calls -- flat dictionary lookup by name |
| Classpath scanning | `loadProgram()` reads all `.md` files in the directory, classifies by `kind`/`role` |

Where it diverges:

| Spring | node-rlm |
|--------|----------|
| Single top-level container | Every delegating agent is a container |
| Static wiring at startup | Runtime topology decisions at every delegation point |
| Container is infrastructure (dumb executor) | Container is intelligence (the LLM reasons about composition) |
| Components receive dependencies | Components are selected and composed by intelligent agents |
| Fails fast on bad wiring | Bad composition manifests as wasted iterations deep in the tree |

## The Erlang/OTP Parallel

Erlang/OTP supervision trees use a small vocabulary of supervision strategies (`one_for_one`, `one_for_all`, `rest_for_one`). Supervisors make local composition decisions using this bounded vocabulary. The strategies are grounded in observable behavior (which child crashed, how to restart), not abstractions.

The composition vocabulary serves the same purpose. `direct`, `coordinated`, `exploratory`, `targeted` are a small set of named strategies grounded in observable state conditions (budget remaining, mechanics confirmed, retry count, depth headroom). Composition decisions are local -- each delegating agent selects from the vocabulary based on its own situation.

The Erlang parallel has a limit. OTP strategies are hard constraints enforced by the runtime. The composition vocabulary is not enforced -- it is a set of named patterns the model can lean on, improve upon, or ignore. "Here are patterns that work well" is a guideline. "You must select from these" would be a bet against the model. The hand-designed vocabulary is a seed: useful for bootstrapping because current models aren't reliable at meta-reasoning about composition from scratch, but the long-term move is to let effective patterns emerge from traces rather than from intuitions.

## What Is Not Implemented Yet

**Oversight-rlm primitive.** A component that watches the progress of another RLM and intervenes if it goes off course. This would be a new component in the catalog that any composing agent could select when it wants monitoring of a downstream delegation. Not yet designed.

**Self-improving programs.** Programs that start with general composition and harden control flow as they learn the task -- writing more specific programs to lock in what works, but backing off when those programs become brittle. The challenge is avoiding overfitting. Conceptually identified; not yet designed.

**Composition unit tests.** Scenarios where the right and wrong composition are obvious, used to test whether the model chooses correctly from just the `root.md` content -- without running a full eval. Would accelerate iteration on composition principles.

**Container-as-own-rlm-call.** Making the composition decision a separate `rlm()` invocation that returns a proposed delegation path, which subsequent component RLMs follow. Deferred because it is isomorphic to the current orchestrator curation loop -- the GameSolver's between-delegation logic already IS "container logic running between component calls." Splitting it into a separate RLM adds communication overhead without adding intelligence. If empirical evidence shows the model struggles with interleaving composition and orchestration, this could be revisited.

**composition_feedback field.** Children returning structural metadata (complexity assessment, suggested topology for similar tasks, structural issues observed) that the parent uses to adjust composition on subsequent delegations. A small state schema addition, no engine change. Identified as the cheapest path to "continuously-updating composition" but deferred for close oversight during introduction.
