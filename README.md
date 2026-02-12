# node-rlm

An LLM in a REPL loop. The model writes JavaScript that runs in a persistent Node.js sandbox; the loop continues until it calls `return()`. Any invocation can spawn a child via `await rlm(query, context?)` -- same sandbox, separate message history and iteration budget.

Only runtime dependency is `acorn` (JS parser). Any OpenAI-compatible API works.

## Install

```bash
npm install node-rlm
```

Requires Node.js >= 20.

## Quick Start

Clone the repo and install dependencies:

```bash
git clone https://github.com/openprose/node-rlm.git
cd node-rlm
npm install
```

Copy the example env file and add your API key:

```bash
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY
```

Run a query:

```bash
npx tsx src/cli.ts --query "What is the capital of France?"
```

Run a quick eval:

```bash
# S-NIAH (synthetic, no download needed)
npx tsx eval/run.ts --benchmark s-niah --model anthropic/claude-sonnet-4-20250514 --max-tasks 5

# OOLONG (requires one-time dataset download)
npx tsx eval/download.ts
npx tsx eval/run.ts --benchmark oolong --model anthropic/claude-sonnet-4-20250514 --max-tasks 5
```

See [eval/README.md](eval/README.md) for the full set of eval options, plugin configuration, and result analysis.

## CLI

```bash
npx node-rlm --query "What is the capital of France?"
npx node-rlm --query "Summarize this file" --context-file ./data.txt
npx node-rlm --query "Find all TODO comments" --context-dir ./src/
npx node-rlm --query "Analyze this data" --model openai/gpt-4o
npx node-rlm --query "Hello" --model custom/my-model --base-url http://localhost:11434/v1
```

| Flag | Default | Description |
|------|---------|-------------|
| `--query <text>` | (required) | The question or task |
| `--context-file <path>` | -- | Load context from a file |
| `--context-dir <path>` | -- | Load context from a directory (concatenates all files) |
| `--model <provider/id>` | `openrouter/google/gemini-3-flash-preview` | Model in `provider/model-id` format |
| `--base-url <url>` | -- | Custom API base URL (for Ollama, vLLM, etc.) |
| `--max-iterations <n>` | 15 | Maximum REPL loop iterations (root) |
| `--max-depth <n>` | 3 | Maximum recursion depth; beyond this, `rlm()` is one-shot |

### Providers

The CLI routes models by the first path segment:

- `openrouter/*` -- OpenRouter API (`OPENROUTER_API_KEY`)
- `openai/*` -- OpenAI API (`OPENAI_API_KEY`)
- `custom/*` -- requires `--base-url` and the relevant env var

## Programmatic API

```typescript
import { rlm } from "node-rlm";
import { fromProviderModel } from "node-rlm/drivers/openrouter-compatible";

const callLLM = fromProviderModel("openrouter/google/gemini-3-flash-preview");
const result = await rlm("What is 2 + 2?", undefined, {
  callLLM,
  maxIterations: 15,
  maxDepth: 3,
});

console.log(result.answer);     // "4"
console.log(result.iterations); // number of REPL turns used
console.log(result.trace);      // { reasoning, code, output, error } per turn
```

### `rlm(query, context?, options)`

Returns `RlmResult`: `{ answer, iterations, trace }`.

Throws `RlmMaxIterationsError` if the iteration budget is exhausted (carries partial `trace` for inspection).

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `callLLM` | `CallLLM` | (required) | `(messages, systemPrompt) => Promise<string>` |
| `maxIterations` | `number` | 15 | REPL loop budget for the root agent |
| `maxDepth` | `number` | 3 | Recursion depth limit |
| `pluginBodies` | `string` | -- | Extra prompt text appended to the root agent's system prompt |

### Sandbox globals

These are available to the model inside the REPL:

| Symbol | Description |
|--------|-------------|
| `context` | Task data (reads `__ctx.local.context`, falling back to `__ctx.shared.data`). |
| `console.log()` | Output visible to the model between iterations. |
| `return(value)` | Ends the loop and sets the final answer. First-iteration returns are intercepted for verification. |
| `await rlm(query, context?, { systemPrompt? })` | Spawn a child RLM. Shared sandbox, own message history. Must be awaited. |
| `await llm(query, context?)` | One-shot LLM call. No REPL, no iteration. |
| `__rlm` | Read-only delegation context: `depth`, `maxDepth`, `iteration`, `maxIterations`, `lineage`, `invocationId`, `parentId`. |
| `__ctx.shared.data` | Root context (frozen, readable by all depths). |
| `__ctx.local` | This invocation's writable workspace. |
| `__ctx.readLocal(id)` | Read-only view of another invocation's local store. |
| `require()` | Node.js built-in modules only. |

The sandbox is shared across depths. Iteration budget decays with depth: root gets `maxIterations`, children are capped at 7, 4, 3.

## Plugins

Plugins are markdown files that get concatenated into the root agent's system prompt via `pluginBodies`.

- `plugins/drivers/` -- Model-specific reliability patches (e.g., suppress hallucinated tool calls, enforce one code block per turn). Stack multiple per run.
- `plugins/apps/` -- Task architectures (e.g., structured data aggregation, recursive delegation). Typically one per run.
- `plugins/profiles/` -- Profiles use YAML frontmatter to map model name patterns to a list of drivers. The plugin loader picks the right profile automatically.

```typescript
import { loadStack } from "node-rlm/plugins"; // or import from source
const pluginBodies = await loadStack({
  model: "openrouter/google/gemini-3-flash-preview", // auto-detects profile
  app: "structured-data-aggregation",
});
```

## Project structure

```
src/
  rlm.ts              The core REPL loop and delegation logic
  system-prompt.ts    System prompts and child templates
  plugins.ts          Plugin loader (loadStack, loadPlugins, loadProfile, detectProfile)
  environment.ts      vm-based sandbox
  cli.ts              CLI entry point
  drivers/
    openrouter-compatible.ts   CallLLM adapter for OpenAI-compatible APIs

plugins/
  drivers/            Model-specific reliability patches
  apps/               Task-strategy prompts
  profiles/           Model-to-driver mappings

eval/                 Benchmark harness (OOLONG, S-NIAH) -- see eval/README.md
test/                 Vitest tests
```

## Testing

Unit tests (no API key needed):

```bash
npm test
```

End-to-end tests run automatically when `OPENROUTER_API_KEY` is set, and are skipped otherwise.

## License

MIT
