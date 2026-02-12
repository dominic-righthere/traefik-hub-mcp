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
