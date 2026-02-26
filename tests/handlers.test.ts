import { describe, it, expect, vi } from 'vitest'
import {
  generateLabels,
  getMiddlewareTypes,
  checkSetupConfig,
  formatSetupCheckResults,
  addMiddlewareToConfig,
  updateCorsOrigins,
  isDatabaseImage,
  isLocalhostOnly,
  checkDatabasePorts,
  DATABASE_IMAGE_PATTERNS,
  parseSemver,
  parsePinnedVersion,
  compareVersions,
  analyzeUpdate,
  formatUpdateReport,
  buildDomainRule,
  addDomainRoute,
  removeDomainRoute,
  listDomainRoutes,
} from '../src/handlers.js'
import { parse, stringify } from 'yaml'

describe('generateLabels', () => {
  it('generates basic labels without middlewares', () => {
    const result = generateLabels('myapp', 'myapp.localhost', 3000)

    expect(result).toContain('traefik.enable=true')
    expect(result).toContain('traefik.http.routers.myapp.rule=Host(`myapp.localhost`)')
    expect(result).toContain('traefik.http.services.myapp.loadbalancer.server.port=3000')
    expect(result).toContain('# Access at: http://myapp.localhost')
    expect(result).not.toContain('middlewares=')
  })

  it('includes middlewares when provided', () => {
    const result = generateLabels('api', 'api.localhost', 8000, ['cors-dev@file', 'rate-limit@file'])

    expect(result).toContain('traefik.http.routers.api.middlewares=cors-dev@file,rate-limit@file')
  })

  it('generates correct service name in output', () => {
    const result = generateLabels('frontend', 'app.localhost', 5000)

    expect(result).toContain('services:')
    expect(result).toContain('frontend:')
    expect(result).toContain('networks:')
    expect(result).toContain('traefik-public')
    expect(result).toContain('external: true')
  })

  it('handles empty middlewares array', () => {
    const result = generateLabels('app', 'app.localhost', 3000, [])

    expect(result).not.toContain('middlewares=')
  })

  it('includes HTTP vs TCP guidance', () => {
    const result = generateLabels('myapp', 'myapp.localhost', 3000)

    expect(result).toContain('## When to Route Through Traefik')
    expect(result).toContain('**HTTP services (web apps, APIs)** - Route through Traefik')
    expect(result).toContain('**TCP services (databases, caches)** - Keep internal')
    expect(result).toContain('docker compose exec')
  })
})

describe('getMiddlewareTypes', () => {
  it('returns markdown with middleware types', () => {
    const result = getMiddlewareTypes()

    expect(result).toContain('# Available Traefik Middleware Types')
    expect(result).toContain('## headers')
    expect(result).toContain('## rateLimit')
    expect(result).toContain('## stripPrefix')
    expect(result).toContain('## addPrefix')
    expect(result).toContain('## redirectScheme')
    expect(result).toContain('## basicAuth')
    expect(result).toContain('## compress')
    expect(result).toContain('## retry')
    expect(result).toContain('## circuitBreaker')
  })

  it('includes JSON examples for each type', () => {
    const result = getMiddlewareTypes()

    // Check for JSON code blocks
    expect(result).toContain('```json')
    // Check for specific config examples
    expect(result).toContain('"frameDeny": true')
    expect(result).toContain('"average": 100')
    expect(result).toContain('"prefixes": ["/api"]')
  })

  it('includes usage instructions', () => {
    const result = getMiddlewareTypes()

    expect(result).toContain('Use the `add_middleware` tool')
    expect(result).toContain('https://doc.traefik.io/traefik/middlewares/http/overview/')
  })
})

describe('checkSetupConfig', () => {
  it('returns ok when all paths are valid', async () => {
    const readFile = vi.fn().mockResolvedValue('content')

    const result = await checkSetupConfig({
      hubDir: '/custom/hub',
      configDir: '/custom/config',
      apiUrl: 'http://localhost:8080',
      defaultHubDir: '/default/hub',
      defaultConfigDir: '/default/config',
      readFile,
    })

    expect(result.allOk).toBe(true)
    expect(result.checks).toHaveLength(3)
    expect(result.checks[0]).toEqual({ name: 'TRAEFIK_HUB_DIR', ok: true, value: '/custom/hub' })
    expect(result.checks[1]).toEqual({ name: 'TRAEFIK_CONFIG_DIR', ok: true, value: '/custom/config' })
    expect(result.checks[2]).toEqual({ name: 'TRAEFIK_API_URL', ok: true, value: 'http://localhost:8080' })
  })

  it('uses defaults when env vars not set', async () => {
    const readFile = vi.fn().mockResolvedValue('content')

    const result = await checkSetupConfig({
      hubDir: undefined,
      configDir: undefined,
      apiUrl: 'http://localhost:8080',
      defaultHubDir: '/default/hub',
      defaultConfigDir: '/default/config',
      readFile,
    })

    expect(result.allOk).toBe(true)
    expect(result.checks[0]).toEqual({ name: 'TRAEFIK_HUB_DIR', ok: true, value: '/default/hub', isDefault: true })
    expect(result.checks[1]).toEqual({ name: 'TRAEFIK_CONFIG_DIR', ok: true, value: '/default/config', isDefault: true })
  })

  it('reports failure when hub dir is invalid', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('ENOENT'))

    const result = await checkSetupConfig({
      hubDir: '/bad/path',
      configDir: undefined,
      apiUrl: 'http://localhost:8080',
      defaultHubDir: '/default/hub',
      defaultConfigDir: '/default/config',
      readFile,
    })

    expect(result.allOk).toBe(false)
    expect(result.checks[0].ok).toBe(false)
    expect(result.checks[0].error).toContain('invalid')
  })

  it('reports failure when default paths are invalid', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('ENOENT'))

    const result = await checkSetupConfig({
      hubDir: undefined,
      configDir: undefined,
      apiUrl: 'http://localhost:8080',
      defaultHubDir: '/nonexistent/hub',
      defaultConfigDir: '/nonexistent/config',
      readFile,
    })

    expect(result.allOk).toBe(false)
    expect(result.checks.filter(c => !c.ok)).toHaveLength(2)
  })
})

describe('formatSetupCheckResults', () => {
  it('formats successful checks with checkmarks', () => {
    const result = formatSetupCheckResults({
      checks: [
        { name: 'TRAEFIK_HUB_DIR', ok: true, value: '/path/to/hub' },
        { name: 'TRAEFIK_API_URL', ok: true, value: 'http://localhost:8080' },
      ],
      allOk: true,
    })

    expect(result).toContain('✓ TRAEFIK_HUB_DIR: /path/to/hub')
    expect(result).toContain('✓ TRAEFIK_API_URL: http://localhost:8080')
    expect(result).toContain('**Configuration OK!**')
  })

  it('marks default values', () => {
    const result = formatSetupCheckResults({
      checks: [
        { name: 'TRAEFIK_HUB_DIR', ok: true, value: '/default/path', isDefault: true },
      ],
      allOk: true,
    })

    expect(result).toContain('✓ TRAEFIK_HUB_DIR: /default/path (default)')
  })

  it('formats failed checks with X and shows setup instructions', () => {
    const result = formatSetupCheckResults({
      checks: [
        { name: 'TRAEFIK_HUB_DIR', ok: false, error: 'not set and default path invalid' },
      ],
      allOk: false,
    })

    expect(result).toContain('✗ TRAEFIK_HUB_DIR not set and default path invalid')
    expect(result).toContain('**Setup required.**')
    expect(result).toContain('"TRAEFIK_HUB_DIR"')
  })
})

describe('addMiddlewareToConfig', () => {
  const existingConfig = `http:
  middlewares:
    cors-dev:
      headers:
        accessControlAllowOriginList:
          - http://localhost:3000
`

  it('adds new middleware to existing config', () => {
    const result = addMiddlewareToConfig(
      existingConfig,
      'rate-limit',
      'rateLimit',
      { average: 100, burst: 50 },
      parse,
      stringify
    )

    expect(result.success).toBe(true)
    expect(result.newContent).toContain('rate-limit')
    expect(result.newContent).toContain('rateLimit')
    expect(result.addedYaml).toContain('rate-limit')
  })

  it('fails if middleware already exists', () => {
    const result = addMiddlewareToConfig(
      existingConfig,
      'cors-dev',
      'headers',
      { frameDeny: true },
      parse,
      stringify
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
  })

  it('creates http.middlewares structure if missing', () => {
    const emptyConfig = ''
    const result = addMiddlewareToConfig(
      emptyConfig,
      'new-middleware',
      'headers',
      { frameDeny: true },
      parse,
      stringify
    )

    expect(result.success).toBe(true)
    expect(result.newContent).toContain('new-middleware')
  })

  it('fails on invalid YAML', () => {
    const invalidYaml = '{ invalid yaml ['
    const result = addMiddlewareToConfig(
      invalidYaml,
      'test',
      'headers',
      {},
      () => { throw new Error('parse error') },
      stringify
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Could not parse')
  })
})

describe('updateCorsOrigins', () => {
  it('adds new origins', () => {
    const result = updateCorsOrigins(
      ['http://localhost:3000'],
      ['http://myapp.localhost'],
      undefined
    )

    expect(result.origins).toEqual(['http://localhost:3000', 'http://myapp.localhost'])
    expect(result.changes).toEqual(['+ http://myapp.localhost'])
  })

  it('removes existing origins', () => {
    const result = updateCorsOrigins(
      ['http://localhost:3000', 'http://old.localhost'],
      undefined,
      ['http://old.localhost']
    )

    expect(result.origins).toEqual(['http://localhost:3000'])
    expect(result.changes).toEqual(['- http://old.localhost'])
  })

  it('does not add duplicates', () => {
    const result = updateCorsOrigins(
      ['http://localhost:3000'],
      ['http://localhost:3000'],
      undefined
    )

    expect(result.origins).toEqual(['http://localhost:3000'])
    expect(result.changes).toEqual([])
  })

  it('handles both add and remove in same call', () => {
    const result = updateCorsOrigins(
      ['http://localhost:3000', 'http://old.localhost'],
      ['http://new.localhost'],
      ['http://old.localhost']
    )

    expect(result.origins).toEqual(['http://localhost:3000', 'http://new.localhost'])
    expect(result.changes).toContain('+ http://new.localhost')
    expect(result.changes).toContain('- http://old.localhost')
  })

  it('ignores removal of non-existent origins', () => {
    const result = updateCorsOrigins(
      ['http://localhost:3000'],
      undefined,
      ['http://nonexistent.localhost']
    )

    expect(result.origins).toEqual(['http://localhost:3000'])
    expect(result.changes).toEqual([])
  })
})

describe('isDatabaseImage', () => {
  it('detects common database images', () => {
    expect(isDatabaseImage('postgres:15')).toBe(true)
    expect(isDatabaseImage('mysql:8')).toBe(true)
    expect(isDatabaseImage('mongo:6')).toBe(true)
    expect(isDatabaseImage('redis:7')).toBe(true)
    expect(isDatabaseImage('mariadb:10')).toBe(true)
    expect(isDatabaseImage('memcached:latest')).toBe(true)
  })

  it('handles registry prefixes', () => {
    expect(isDatabaseImage('docker.io/library/postgres:15')).toBe(true)
    expect(isDatabaseImage('gcr.io/project/postgresql:latest')).toBe(true)
  })

  it('is case insensitive', () => {
    expect(isDatabaseImage('POSTGRES:15')).toBe(true)
    expect(isDatabaseImage('MySQL:8')).toBe(true)
  })

  it('returns false for non-database images', () => {
    expect(isDatabaseImage('nginx:latest')).toBe(false)
    expect(isDatabaseImage('node:18')).toBe(false)
    expect(isDatabaseImage('traefik:v2.10')).toBe(false)
  })
})

describe('isLocalhostOnly', () => {
  it('identifies localhost IPs', () => {
    expect(isLocalhostOnly('127.0.0.1')).toBe(true)
    expect(isLocalhostOnly('::1')).toBe(true)
    expect(isLocalhostOnly('localhost')).toBe(true)
    expect(isLocalhostOnly('')).toBe(true)
  })

  it('returns false for non-localhost IPs', () => {
    expect(isLocalhostOnly('0.0.0.0')).toBe(false)
    expect(isLocalhostOnly('192.168.1.1')).toBe(false)
    expect(isLocalhostOnly('10.0.0.1')).toBe(false)
  })
})

describe('checkDatabasePorts', () => {
  it('returns allSafe when no databases have exposed ports', () => {
    const containers = [
      { name: 'web', image: 'nginx:latest', ports: [{ IP: '0.0.0.0', PrivatePort: 80, PublicPort: 80 }] },
      { name: 'db', image: 'postgres:15', ports: [{ IP: '', PrivatePort: 5432 }] },
    ]

    const result = checkDatabasePorts(containers)

    expect(result.allSafe).toBe(true)
    expect(result.exposedDatabases).toEqual([])
  })

  it('detects databases with exposed ports', () => {
    const containers = [
      { name: 'mydb', image: 'postgres:15', ports: [{ IP: '0.0.0.0', PrivatePort: 5432, PublicPort: 5432 }] },
    ]

    const result = checkDatabasePorts(containers)

    expect(result.allSafe).toBe(false)
    expect(result.exposedDatabases).toHaveLength(1)
    expect(result.exposedDatabases[0]).toContain('mydb')
    expect(result.exposedDatabases[0]).toContain('postgres')
    expect(result.exposedDatabases[0]).toContain('5432')
  })

  it('allows localhost-only database ports', () => {
    const containers = [
      { name: 'mydb', image: 'postgres:15', ports: [{ IP: '127.0.0.1', PrivatePort: 5432, PublicPort: 5432 }] },
    ]

    const result = checkDatabasePorts(containers)

    expect(result.allSafe).toBe(true)
  })

  it('detects multiple exposed databases', () => {
    const containers = [
      { name: 'pg', image: 'postgres:15', ports: [{ IP: '0.0.0.0', PrivatePort: 5432, PublicPort: 5432 }] },
      { name: 'redis', image: 'redis:7', ports: [{ IP: '0.0.0.0', PrivatePort: 6379, PublicPort: 6379 }] },
    ]

    const result = checkDatabasePorts(containers)

    expect(result.allSafe).toBe(false)
    expect(result.exposedDatabases).toHaveLength(2)
  })

  it('ignores non-database containers with exposed ports', () => {
    const containers = [
      { name: 'web', image: 'nginx:latest', ports: [{ IP: '0.0.0.0', PrivatePort: 80, PublicPort: 80 }] },
    ]

    const result = checkDatabasePorts(containers)

    expect(result.allSafe).toBe(true)
  })
})

describe('DATABASE_IMAGE_PATTERNS', () => {
  it('includes common database types', () => {
    expect(DATABASE_IMAGE_PATTERNS).toContain('postgres')
    expect(DATABASE_IMAGE_PATTERNS).toContain('mysql')
    expect(DATABASE_IMAGE_PATTERNS).toContain('mongo')
    expect(DATABASE_IMAGE_PATTERNS).toContain('redis')
    expect(DATABASE_IMAGE_PATTERNS).toContain('elasticsearch')
  })
})

describe('parseSemver', () => {
  it('parses full version string', () => {
    expect(parseSemver('3.6.1')).toEqual({ major: 3, minor: 6, patch: 1, raw: '3.6.1' })
  })

  it('parses version with v prefix', () => {
    expect(parseSemver('v3.6.1')).toEqual({ major: 3, minor: 6, patch: 1, raw: 'v3.6.1' })
  })

  it('defaults patch to 0 when missing', () => {
    expect(parseSemver('v3.6')).toEqual({ major: 3, minor: 6, patch: 0, raw: 'v3.6' })
  })

  it('extracts version embedded in image string', () => {
    expect(parseSemver('traefik:v3.6')).toEqual({ major: 3, minor: 6, patch: 0, raw: 'traefik:v3.6' })
  })

  it('returns null for non-version string', () => {
    expect(parseSemver('latest')).toBeNull()
    expect(parseSemver('hello')).toBeNull()
  })

  it('handles multi-digit components', () => {
    expect(parseSemver('v12.34.56')).toEqual({ major: 12, minor: 34, patch: 56, raw: 'v12.34.56' })
  })
})

describe('parsePinnedVersion', () => {
  it('extracts version from standard compose content', () => {
    const content = `services:\n  traefik:\n    image: traefik:v3.6\n    container_name: traefik\n`
    const result = parsePinnedVersion(content)
    expect(result).toEqual({ major: 3, minor: 6, patch: 0, raw: 'v3.6' })
  })

  it('extracts version with patch number', () => {
    const content = `services:\n  traefik:\n    image: traefik:v3.6.2\n`
    const result = parsePinnedVersion(content)
    expect(result).toEqual({ major: 3, minor: 6, patch: 2, raw: 'v3.6.2' })
  })

  it('returns null when no traefik image found', () => {
    const content = `services:\n  web:\n    image: nginx:latest\n`
    expect(parsePinnedVersion(content)).toBeNull()
  })

  it('returns null for traefik:latest', () => {
    const content = `services:\n  traefik:\n    image: traefik:latest\n`
    expect(parsePinnedVersion(content)).toBeNull()
  })
})

describe('compareVersions', () => {
  it('detects patch bump', () => {
    expect(compareVersions(
      { major: 3, minor: 6, patch: 0, raw: '3.6.0' },
      { major: 3, minor: 6, patch: 1, raw: '3.6.1' }
    )).toBe('patch')
  })

  it('detects minor bump', () => {
    expect(compareVersions(
      { major: 3, minor: 6, patch: 0, raw: '3.6.0' },
      { major: 3, minor: 7, patch: 0, raw: '3.7.0' }
    )).toBe('minor')
  })

  it('detects major bump', () => {
    expect(compareVersions(
      { major: 3, minor: 6, patch: 0, raw: '3.6.0' },
      { major: 4, minor: 0, patch: 0, raw: '4.0.0' }
    )).toBe('major')
  })

  it('detects no change', () => {
    expect(compareVersions(
      { major: 3, minor: 6, patch: 1, raw: '3.6.1' },
      { major: 3, minor: 6, patch: 1, raw: '3.6.1' }
    )).toBe('none')
  })

  it('detects downgrade', () => {
    expect(compareVersions(
      { major: 3, minor: 7, patch: 0, raw: '3.7.0' },
      { major: 3, minor: 6, patch: 0, raw: '3.6.0' }
    )).toBe('downgrade')
  })

  it('major takes precedence over minor', () => {
    expect(compareVersions(
      { major: 3, minor: 9, patch: 9, raw: '3.9.9' },
      { major: 4, minor: 0, patch: 0, raw: '4.0.0' }
    )).toBe('major')
  })
})

describe('analyzeUpdate', () => {
  it('returns up-to-date when versions match', () => {
    const result = analyzeUpdate({
      runningVersion: '3.6.0',
      dockerComposeContent: 'image: traefik:v3.6',
      latestRelease: { tag: 'v3.6.0', body: 'notes' },
    })
    expect(result.safetyLevel).toBe('up-to-date')
    expect(result.updateType).toBe('none')
  })

  it('returns safe for patch bump', () => {
    const result = analyzeUpdate({
      runningVersion: '3.6.0',
      dockerComposeContent: 'image: traefik:v3.6',
      latestRelease: { tag: 'v3.6.1', body: 'patch notes' },
    })
    expect(result.safetyLevel).toBe('safe')
    expect(result.updateType).toBe('patch')
  })

  it('returns generally-safe for minor bump', () => {
    const result = analyzeUpdate({
      runningVersion: '3.6.0',
      dockerComposeContent: 'image: traefik:v3.6',
      latestRelease: { tag: 'v3.7.0', body: '' },
    })
    expect(result.safetyLevel).toBe('generally-safe')
    expect(result.updateType).toBe('minor')
  })

  it('returns review-required for major bump', () => {
    const result = analyzeUpdate({
      runningVersion: '3.6.0',
      dockerComposeContent: 'image: traefik:v3.6',
      latestRelease: { tag: 'v4.0.0', body: 'breaking changes' },
    })
    expect(result.safetyLevel).toBe('review-required')
    expect(result.updateType).toBe('major')
  })

  it('falls back to pinned version when running is unavailable', () => {
    const result = analyzeUpdate({
      runningVersion: null,
      dockerComposeContent: 'image: traefik:v3.6.0',
      latestRelease: { tag: 'v3.6.1', body: '' },
    })
    expect(result.safetyLevel).toBe('safe')
    expect(result.running).toBeNull()
    expect(result.pinned).not.toBeNull()
  })

  it('returns error when running version is missing and no pinned', () => {
    const result = analyzeUpdate({
      runningVersion: null,
      dockerComposeContent: null,
      latestRelease: { tag: 'v3.6.0', body: '' },
    })
    expect(result.safetyLevel).toBe('error')
  })

  it('returns error when latest release is missing', () => {
    const result = analyzeUpdate({
      runningVersion: '3.6.0',
      dockerComposeContent: 'image: traefik:v3.6',
      latestRelease: null,
    })
    expect(result.safetyLevel).toBe('error')
  })

  it('returns error when all inputs are missing', () => {
    const result = analyzeUpdate({
      runningVersion: null,
      dockerComposeContent: null,
      latestRelease: null,
    })
    expect(result.safetyLevel).toBe('error')
  })
})

describe('buildDomainRule', () => {
  it('builds rule for simple host with multiple aliases', () => {
    const result = buildDomainRule('baby.localhost', ['local.domlee.dev', 'other.domlee.dev'])
    expect(result).toBe("Host(`baby.local.domlee.dev`) || Host(`baby.other.domlee.dev`)")
  })

  it('builds rule for subdomain host', () => {
    const result = buildDomainRule('api.baby.localhost', ['local.domlee.dev', 'other.domlee.dev'])
    expect(result).toBe("Host(`api.baby.local.domlee.dev`) || Host(`api.baby.other.domlee.dev`)")
  })

  it('builds rule with single alias', () => {
    const result = buildDomainRule('baby.localhost', ['local.domlee.dev'])
    expect(result).toBe("Host(`baby.local.domlee.dev`)")
  })
})

describe('addDomainRoute', () => {
  const existingYaml = `http:
  routers:
    baby-web-alt:
      rule: "Host(\`baby.local.domlee.dev\`) || Host(\`baby.other.domlee.dev\`)"
      service: baby-web@docker
      entryPoints:
        - web
`
  const aliases = ['local.domlee.dev', 'other.domlee.dev']

  it('adds a new route', () => {
    const result = addDomainRoute(existingYaml, 'career-web-alt', 'career.localhost', 'career-web', aliases, parse, stringify)
    expect(result.success).toBe(true)
    expect(result.newContent).toContain('career-web-alt')
    expect(result.newContent).toContain('career-web@docker')
  })

  it('rejects duplicate router name', () => {
    const result = addDomainRoute(existingYaml, 'baby-web-alt', 'baby.localhost', 'baby-web', aliases, parse, stringify)
    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
  })

  it('creates structure from empty YAML', () => {
    const result = addDomainRoute('', 'new-route', 'app.localhost', 'app', aliases, parse, stringify)
    expect(result.success).toBe(true)
    expect(result.newContent).toContain('new-route')
    expect(result.newContent).toContain('app@docker')
  })
})

describe('removeDomainRoute', () => {
  const existingYaml = `http:
  routers:
    baby-web-alt:
      rule: "Host(\`baby.local.domlee.dev\`)"
      service: baby-web@docker
      entryPoints:
        - web
    career-web-alt:
      rule: "Host(\`career.local.domlee.dev\`)"
      service: career-web@docker
      entryPoints:
        - web
`

  it('removes an existing route', () => {
    const result = removeDomainRoute(existingYaml, 'baby-web-alt', parse, stringify)
    expect(result.success).toBe(true)
    expect(result.newContent).not.toContain('baby-web-alt')
    expect(result.newContent).toContain('career-web-alt')
  })

  it('errors on missing route', () => {
    const result = removeDomainRoute(existingYaml, 'nonexistent', parse, stringify)
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('listDomainRoutes', () => {
  it('lists all routes', () => {
    const yaml = `http:
  routers:
    baby-web-alt:
      rule: "Host(\`baby.local.domlee.dev\`)"
      service: baby-web@docker
    career-web-alt:
      rule: "Host(\`career.local.domlee.dev\`)"
      service: career-web@docker
`
    const result = listDomainRoutes(yaml, parse)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('baby-web-alt')
    expect(result[0].service).toBe('baby-web@docker')
    expect(result[1].name).toBe('career-web-alt')
  })

  it('handles empty file', () => {
    const result = listDomainRoutes('', parse)
    expect(result).toEqual([])
  })

  it('handles file with no routers', () => {
    const result = listDomainRoutes('http:\n  middlewares: {}', parse)
    expect(result).toEqual([])
  })
})

describe('formatUpdateReport', () => {
  const baseAnalysis = {
    running: { major: 3, minor: 6, patch: 0, raw: '3.6.0' },
    pinned: { major: 3, minor: 6, patch: 0, raw: 'v3.6' },
    latest: { major: 3, minor: 6, patch: 1, raw: 'v3.6.1' },
    updateType: 'patch' as const,
    safetyLevel: 'safe' as const,
    releaseNotes: 'Bug fixes and improvements.',
  }

  it('includes version table', () => {
    const report = formatUpdateReport(baseAnalysis)
    expect(report).toContain('| Running | 3.6.0 |')
    expect(report).toContain('| Pinned (docker-compose) | v3.6 |')
    expect(report).toContain('| Latest (GitHub) | v3.6.1 |')
  })

  it('shows update instructions when update available', () => {
    const report = formatUpdateReport(baseAnalysis)
    expect(report).toContain('## Update Instructions')
    expect(report).toContain('docker compose pull && docker compose up -d')
  })

  it('hides update instructions when up-to-date', () => {
    const report = formatUpdateReport({
      ...baseAnalysis,
      latest: { major: 3, minor: 6, patch: 0, raw: 'v3.6.0' },
      updateType: 'none',
      safetyLevel: 'up-to-date',
    })
    expect(report).not.toContain('## Update Instructions')
  })

  it('shows pinned vs running mismatch warning', () => {
    const report = formatUpdateReport({
      ...baseAnalysis,
      running: { major: 3, minor: 6, patch: 1, raw: '3.6.1' },
      pinned: { major: 3, minor: 6, patch: 0, raw: 'v3.6.0' },
    })
    expect(report).toContain('differs from pinned version')
  })

  it('includes release notes', () => {
    const report = formatUpdateReport(baseAnalysis)
    expect(report).toContain('## Latest Release Notes')
    expect(report).toContain('Bug fixes and improvements.')
  })

  it('truncates long release notes', () => {
    const longNotes = 'A'.repeat(2000)
    const report = formatUpdateReport({
      ...baseAnalysis,
      releaseNotes: longNotes,
    })
    expect(report).toContain('...')
    expect(report.length).toBeLessThan(longNotes.length + 500)
  })

  it('includes GitHub releases link', () => {
    const report = formatUpdateReport(baseAnalysis)
    expect(report).toContain('https://github.com/traefik/traefik/releases')
  })
})
