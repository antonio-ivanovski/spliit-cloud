import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { AppsSdkAdapter, McpAppsAdapter } from 'mcp-use/server'
import { afterEach, describe, expect, it } from 'vitest'

import { configureBuiltWidgetDomain } from './widget-manifest'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('configureBuiltWidgetDomain', () => {
  it('injects the normalized MCP origin and preserves widget metadata', () => {
    const directory = mkdtempSync(join(tmpdir(), 'spliit-mcp-manifest-'))
    temporaryDirectories.push(directory)
    const manifestPath = join(directory, 'mcp-use.json')
    writeFileSync(
      manifestPath,
      JSON.stringify({
        includeInspector: false,
        widgets: {
          'expense-preview': {
            metadata: {
              prefersBorder: false,
              invoking: 'Preparing preview',
            },
          },
        },
      }),
    )

    expect(
      configureBuiltWidgetDomain(
        pathToFileURL(manifestPath),
        'https://mcp.spliit.cloud/',
      ),
    ).toBe('https://mcp.spliit.cloud')

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(manifest.widgets['expense-preview'].metadata).toEqual({
      prefersBorder: false,
      invoking: 'Preparing preview',
      domain: 'https://mcp.spliit.cloud',
    })
  })

  it('fails before startup when the built widget is missing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'spliit-mcp-manifest-'))
    temporaryDirectories.push(directory)
    const manifestPath = join(directory, 'mcp-use.json')
    writeFileSync(manifestPath, JSON.stringify({ widgets: {} }))

    expect(() =>
      configureBuiltWidgetDomain(
        pathToFileURL(manifestPath),
        'https://mcp.spliit.cloud',
      ),
    ).toThrow('Built expense-preview widget metadata is missing')
  })

  it('maps the configured domain to both MCP Apps and ChatGPT metadata', () => {
    const definition = {
      type: 'mcpApps' as const,
      name: 'expense-preview',
      metadata: { domain: 'https://mcp.spliit.cloud' },
    }

    expect(
      new McpAppsAdapter().buildResourceMetadata(definition)._meta,
    ).toMatchObject({
      ui: { domain: 'https://mcp.spliit.cloud' },
    })
    expect(
      new AppsSdkAdapter().buildResourceMetadata(definition)._meta,
    ).toMatchObject({
      'openai/widgetDomain': 'https://mcp.spliit.cloud',
    })
  })
})
