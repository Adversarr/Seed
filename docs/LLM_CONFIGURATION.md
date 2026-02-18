# LLM and MCP Configuration

## Provider Model

LLM provider selection is configured via environment variables and loaded by `loadAppConfig`.

Supported providers:
- `fake` (default) — deterministic/local testing behavior.
- `openai` — OpenAI-compatible API.
- `bailian` — Alibaba DashScope compatible API.
- `volcengine` — Volcengine Ark compatible API.

Env:
- `SEED_LLM_PROVIDER=fake|openai|bailian|volcengine`
- `SEED_LLM_API_KEY` (required for non-`fake` providers)
- `SEED_LLM_BASE_URL` (optional; provider default is used when omitted)

Provider default base URLs:
- `openai` → `https://api.openai.com/v1`
- `bailian` → `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `volcengine` → `https://ark.cn-beijing.volces.com/api/v3`

## Canonical Workspace Profile Catalog

Use one env var as source of truth:
- `SEED_LLM_PROFILES_JSON`

Default behavior when `SEED_LLM_PROFILES_JSON` is unset:
- load `WORKDIR/profiles.json` if present,
- otherwise fall back to generated defaults.

`SEED_LLM_PROFILES_JSON` supports two forms:
- Inline JSON object string.
- File path to JSON config:
  - Absolute path, or
  - Relative path resolved against the selected workspace directory (`--workspace`).

## Strict Envelope Format

Profiles now use a strict top-level envelope:

```json
{
  "llms": {
    "defaultProfile": "fast",
    "clientPolicies": {
      "default": {
        "openaiCompat": { "enableThinking": true }
      }
    },
    "profiles": {
      "fast": { "model": "gpt-4o-mini", "clientPolicy": "default" },
      "writer": { "model": "gpt-4o", "clientPolicy": "default" },
      "reasoning": { "model": "gpt-4o", "clientPolicy": "default" }
    }
  },
  "mcp": {
    "servers": {}
  }
}
```

Legacy top-level LLM fields (`defaultProfile`, `clientPolicies`, `profiles` directly at root)
are rejected.

## `llms` Schema

- `defaultProfile: string`
- `clientPolicies: Record<string, ClientPolicy>`
- `profiles: Record<string, { model: string; clientPolicy: string }>`

Required built-in profile IDs:
- `fast`
- `writer`
- `reasoning`

Custom profile IDs are allowed.

### `ClientPolicy` schema

- `openaiCompat?: {`
  - `enableThinking?: boolean`
- `}`
- `provider?: {`
  - `bailian?: {`
    - `thinkingBudget?: number`
  - `}`
  - `volcengine?: {`
    - `thinkingType?: enabled|disabled|auto`
    - `reasoningEffort?: minimal|low|medium|high`
  - `}`
- `}`

Provider-specific policy knobs are validated against the active provider and rejected when mismatched.

## `mcp` Schema

`mcp.servers` is a map of MCP server definitions. Each server supports:

- `enabled?: boolean` (default `true`)
- `transport`:
  - `stdio`: `{ type, command, args?, env?, cwd? }`
  - `streamable_http`: `{ type, url, headers?, sessionId? }`
  - `sse`: `{ type, url, headers? }`
- `startupTimeoutMs?: number` (default `10000`)
- `toolTimeoutMs?: number` (default `60000`)
- `includeTools?: string[]`
- `excludeTools?: string[]` (`includeTools` takes precedence)
- `risk?: {`
  - `default?: safe|risky` (default `risky`)
  - `safeReadOnlyHint?: boolean` (default `false`)
  - `safeTools?: string[]`
- `}`

### Example MCP server

```json
{
  "mcp": {
    "servers": {
      "github": {
        "enabled": true,
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-github"],
          "env": {
            "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
          }
        },
        "startupTimeoutMs": 10000,
        "toolTimeoutMs": 60000,
        "includeTools": [],
        "excludeTools": [],
        "risk": {
          "default": "risky",
          "safeReadOnlyHint": false,
          "safeTools": []
        }
      }
    }
  }
}
```

## Runtime Surfaces

`GET /api/runtime` returns:
- `defaultAgentId`
- `streamingEnabled`
- `agents`
- `llm.provider`
- `llm.defaultProfile`
- `llm.profiles[]` (`id`, `model`, `clientPolicy`, `builtin`)
- `llm.globalProfileOverride`

`POST /api/runtime/profile` validates profile IDs dynamically from the catalog.

`POST /api/runtime/profile/clear` clears global profile override.

## Validation

All env parsing is validated through Zod in:
- `src/config/appConfig.ts`
- `src/config/profileCatalog.ts`
- `src/config/llmProfileCatalog.ts`
- `src/config/mcpProfileCatalog.ts`

Invalid values fail fast at startup.
