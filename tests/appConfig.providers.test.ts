import { describe, expect, it } from 'vitest'
import { loadAppConfig } from '../src/config/appConfig.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function toJson(value: unknown): string {
  return JSON.stringify(value)
}

function wrapProfiles(llms: unknown, mcp: unknown = { servers: {} }): Record<string, unknown> {
  return { llms, mcp }
}

function llmFixture(overrides?: {
  defaultProfile?: string
  clientPolicies?: Record<string, unknown>
  profiles?: Record<string, unknown>
}): Record<string, unknown> {
  return {
    defaultProfile: overrides?.defaultProfile ?? 'fast',
    clientPolicies: overrides?.clientPolicies ?? {
      default: {
        openaiCompat: {
          enableThinking: true,
        },
      },
    },
    profiles: overrides?.profiles ?? {
      fast: { model: 'm-fast', clientPolicy: 'default' },
      writer: { model: 'm-writer', clientPolicy: 'default' },
      reasoning: { model: 'm-reasoning', clientPolicy: 'default' },
    },
  }
}

describe('loadAppConfig profile catalog parsing', () => {
  it('parses strict envelope from SEED_LLM_PROFILES_JSON', () => {
    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson(wrapProfiles(llmFixture({
        defaultProfile: 'research_web',
        clientPolicies: {
          default: { openaiCompat: { enableThinking: true } },
          web: { openaiCompat: { enableThinking: true } },
        },
        profiles: {
          fast: { model: 'm-fast', clientPolicy: 'default' },
          writer: { model: 'm-writer', clientPolicy: 'default' },
          reasoning: { model: 'm-reasoning', clientPolicy: 'default' },
          research_web: { model: 'm-web', clientPolicy: 'web' },
        },
      }))),
    })

    expect(config.llm.provider).toBe('openai')
    expect(config.agent.defaultProfile).toBe('research_web')
    expect(config.llm.profiles.profiles.research_web).toEqual({
      model: 'm-web',
      clientPolicy: 'web',
    })
    expect(config.mcp.servers).toEqual({})
  })

  it('rejects legacy top-level profile shape with actionable error', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson(llmFixture()),
    })).toThrow(/strict envelope format/i)
  })

  it('fails when required builtin profile is missing', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson(wrapProfiles(llmFixture({
        profiles: {
          fast: { model: 'm-fast', clientPolicy: 'default' },
          writer: { model: 'm-writer', clientPolicy: 'default' },
        },
      }))),
    })).toThrow(/missing required builtin profile "reasoning"/)
  })

  it('fails when a profile references unknown clientPolicy', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson(wrapProfiles(llmFixture({
        profiles: {
          fast: { model: 'm-fast', clientPolicy: 'unknown' },
          writer: { model: 'm-writer', clientPolicy: 'default' },
          reasoning: { model: 'm-reasoning', clientPolicy: 'default' },
        },
      }))),
    })).toThrow(/references unknown client policy "unknown"/)
  })

  it('fails when provider-specific knobs do not match selected provider', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson(wrapProfiles(llmFixture({
        clientPolicies: {
          default: {
            provider: {
              bailian: {
                thinkingBudget: 64,
              },
            },
          },
        },
      }))),
    })).toThrow(/active provider is "openai"/)
  })

  it('fails when removed openaiCompat.webSearch field is present', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson(wrapProfiles(llmFixture({
        clientPolicies: {
          default: {
            openaiCompat: {
              enableThinking: true,
              webSearch: {
                enabled: true,
              },
            },
          },
        },
      }))),
    })).toThrow(/openaiCompat.*webSearch/)
  })

  it('loads profile envelope from a relative file path resolved against workspaceDir', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'seed-config-'))
    writeFileSync(join(workspaceDir, 'profiles.json'), toJson(wrapProfiles(llmFixture())))

    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: 'profiles.json',
    }, { workspaceDir })

    expect(config.llm.profiles.profiles.fast.model).toBe('m-fast')
  })

  it('loads profile envelope from an absolute file path', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'seed-config-'))
    const absoluteProfilePath = join(workspaceDir, 'profiles-abs.json')
    writeFileSync(absoluteProfilePath, toJson(wrapProfiles(llmFixture({
      profiles: {
        fast: { model: 'm-fast-abs', clientPolicy: 'default' },
        writer: { model: 'm-writer-abs', clientPolicy: 'default' },
        reasoning: { model: 'm-reasoning-abs', clientPolicy: 'default' },
      },
    }))))

    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: absoluteProfilePath,
    })

    expect(config.llm.profiles.profiles.fast.model).toBe('m-fast-abs')
  })

  it('supports inline JSON with leading/trailing whitespace', () => {
    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: ` \n ${toJson(wrapProfiles(llmFixture()))} \n `,
    })

    expect(config.llm.profiles.defaultProfile).toBe('fast')
  })

  it('fails with a clear error when profile file path is unreadable', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'seed-config-'))
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: 'missing-profiles.json',
    }, { workspaceDir })).toThrow(/path is unreadable/)
  })

  it('auto-loads WORKDIR/profiles.json when SEED_LLM_PROFILES_JSON is unset', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'seed-config-'))
    writeFileSync(join(workspaceDir, 'profiles.json'), toJson(wrapProfiles(llmFixture({
      profiles: {
        fast: { model: 'm-default-file-fast', clientPolicy: 'default' },
        writer: { model: 'm-default-file-writer', clientPolicy: 'default' },
        reasoning: { model: 'm-default-file-reasoning', clientPolicy: 'default' },
      },
    }))))

    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
    }, { workspaceDir })

    expect(config.llm.profiles.profiles.fast.model).toBe('m-default-file-fast')
  })

  it('falls back to generated defaults when WORKDIR/profiles.json is missing', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'seed-config-'))
    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
    }, { workspaceDir })

    expect(config.llm.profiles.defaultProfile).toBe('fast')
    expect(config.llm.profiles.profiles.fast.model).toBe('gpt-4o-mini')
    expect(config.mcp.servers).toEqual({})
  })

  it('prefers SEED_LLM_PROFILES_JSON over WORKDIR/profiles.json when both are present', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'seed-config-'))
    writeFileSync(join(workspaceDir, 'profiles.json'), toJson(wrapProfiles(llmFixture({
      profiles: {
        fast: { model: 'm-from-default-file', clientPolicy: 'default' },
        writer: { model: 'm-from-default-file', clientPolicy: 'default' },
        reasoning: { model: 'm-from-default-file', clientPolicy: 'default' },
      },
    }))))

    writeFileSync(join(workspaceDir, 'profiles-env.json'), toJson(wrapProfiles(llmFixture({
      profiles: {
        fast: { model: 'm-from-env-path', clientPolicy: 'default' },
        writer: { model: 'm-from-env-path', clientPolicy: 'default' },
        reasoning: { model: 'm-from-env-path', clientPolicy: 'default' },
      },
    }))))

    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: 'profiles-env.json',
    }, { workspaceDir })

    expect(config.llm.profiles.profiles.fast.model).toBe('m-from-env-path')
  })

  it('fails fast when WORKDIR/profiles.json exists but is invalid', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'seed-config-'))
    writeFileSync(join(workspaceDir, 'profiles.json'), '{not json')

    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
    }, { workspaceDir })).toThrow(/default workspace profiles file/)
  })

  it('parses MCP server defaults from strict envelope', () => {
    const config = loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson(wrapProfiles(llmFixture(), {
        servers: {
          github: {
            transport: {
              type: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              env: {
                GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}',
              },
            },
          },
        },
      })),
    })

    expect(config.mcp.servers.github).toBeDefined()
    expect(config.mcp.servers.github?.enabled).toBe(true)
    expect(config.mcp.servers.github?.startupTimeoutMs).toBe(10_000)
    expect(config.mcp.servers.github?.toolTimeoutMs).toBe(60_000)
    expect(config.mcp.servers.github?.risk.default).toBe('risky')
    expect(config.mcp.servers.github?.risk.safeReadOnlyHint).toBe(false)
    expect(config.mcp.servers.github?.risk.safeTools).toEqual([])
  })

  it('fails when MCP transport config is invalid', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson(wrapProfiles(llmFixture(), {
        servers: {
          bad: {
            transport: {
              type: 'streamable_http',
              url: 'not-a-url',
            },
          },
        },
      })),
    })).toThrow(/llms|mcp/i)
  })

  it('fails when MCP timeout config is invalid', () => {
    expect(() => loadAppConfig({
      SEED_LLM_PROVIDER: 'openai',
      SEED_LLM_API_KEY: 'ok',
      SEED_LLM_PROFILES_JSON: toJson(wrapProfiles(llmFixture(), {
        servers: {
          bad: {
            transport: {
              type: 'stdio',
              command: 'node',
            },
            startupTimeoutMs: 0,
          },
        },
      })),
    })).toThrow(/startupTimeoutMs|llms|mcp/i)
  })
})
