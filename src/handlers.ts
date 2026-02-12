/**
 * Testable handler functions extracted from index.ts
 * These are pure functions that don't depend on external services
 */

/**
 * Generate docker-compose traefik labels for a project
 */
export function generateLabels(
  name: string,
  domain: string,
  port: number,
  middlewares?: string[]
): string {
  const labels = [
    `traefik.enable=true`,
    `traefik.http.routers.${name}.rule=Host(\`${domain}\`)`,
    `traefik.http.services.${name}.loadbalancer.server.port=${port}`,
  ]

  if (middlewares && middlewares.length > 0) {
    labels.push(`traefik.http.routers.${name}.middlewares=${middlewares.join(',')}`)
  }

  const labelsYaml = labels.map((l) => `      - "${l}"`).join('\n')

  return `# Docker Compose labels for ${name}
# Add to your service in docker-compose.yml:

services:
  ${name}:
    # ... your service config ...
    labels:
${labelsYaml}
    networks:
      - traefik-public

networks:
  traefik-public:
    external: true

# Access at: http://${domain}

---

## When to Route Through Traefik

**HTTP services (web apps, APIs)** - Route through Traefik:
- Web applications, REST APIs, GraphQL endpoints
- Any service that communicates over HTTP/HTTPS

**TCP services (databases, caches)** - Keep internal, no Traefik routing:
- PostgreSQL, MySQL, MongoDB, Redis, etc.
- Keep them on the internal Docker network only (no \`ports:\` mapping)

**Accessing internal services:**
\`\`\`bash
docker compose exec <db-service> psql -U postgres
docker compose exec <service-name> sh
\`\`\``
}

/**
 * Get available middleware types with examples
 */
export function getMiddlewareTypes(): string {
  return `# Available Traefik Middleware Types

## headers
Add or modify HTTP headers.
\`\`\`json
{
  "name": "secure-headers",
  "type": "headers",
  "config": {
    "frameDeny": true,
    "browserXssFilter": true,
    "contentTypeNosniff": true,
    "referrerPolicy": "strict-origin-when-cross-origin"
  }
}
\`\`\`

## rateLimit
Limit request rate.
\`\`\`json
{
  "name": "my-rate-limit",
  "type": "rateLimit",
  "config": {
    "average": 100,
    "burst": 50
  }
}
\`\`\`

## stripPrefix
Remove path prefix before forwarding.
\`\`\`json
{
  "name": "strip-api",
  "type": "stripPrefix",
  "config": {
    "prefixes": ["/api"]
  }
}
\`\`\`

## addPrefix
Add path prefix before forwarding.
\`\`\`json
{
  "name": "add-api",
  "type": "addPrefix",
  "config": {
    "prefix": "/api"
  }
}
\`\`\`

## redirectScheme
Redirect HTTP to HTTPS.
\`\`\`json
{
  "name": "https-redirect",
  "type": "redirectScheme",
  "config": {
    "scheme": "https",
    "permanent": true
  }
}
\`\`\`

## basicAuth
HTTP Basic Authentication.
\`\`\`json
{
  "name": "my-auth",
  "type": "basicAuth",
  "config": {
    "users": ["user:$apr1$hash"]
  }
}
\`\`\`

## compress
Enable gzip/brotli compression.
\`\`\`json
{
  "name": "gzip",
  "type": "compress",
  "config": {}
}
\`\`\`

## retry
Retry failed requests.
\`\`\`json
{
  "name": "retry-middleware",
  "type": "retry",
  "config": {
    "attempts": 3
  }
}
\`\`\`

## circuitBreaker
Stop forwarding when errors exceed threshold.
\`\`\`json
{
  "name": "cb",
  "type": "circuitBreaker",
  "config": {
    "expression": "NetworkErrorRatio() > 0.5"
  }
}
\`\`\`

---

Use the \`add_middleware\` tool to add any of these to your configuration.
See full docs: https://doc.traefik.io/traefik/middlewares/http/overview/`
}

/**
 * Check setup configuration - returns array of check results
 */
export interface SetupCheckResult {
  name: string
  ok: boolean
  value?: string
  isDefault?: boolean
  error?: string
}

export async function checkSetupConfig(deps: {
  hubDir: string | undefined
  configDir: string | undefined
  apiUrl: string
  defaultHubDir: string
  defaultConfigDir: string
  readFile: (path: string) => Promise<string>
}): Promise<{ checks: SetupCheckResult[]; allOk: boolean }> {
  const checks: SetupCheckResult[] = []
  let allOk = true

  // Check TRAEFIK_HUB_DIR
  const hubDir = deps.hubDir
  if (!hubDir) {
    try {
      await deps.readFile(`${deps.defaultHubDir}/docker-compose.yml`)
      checks.push({ name: 'TRAEFIK_HUB_DIR', ok: true, value: deps.defaultHubDir, isDefault: true })
    } catch {
      checks.push({ name: 'TRAEFIK_HUB_DIR', ok: false, error: 'not set and default path invalid' })
      allOk = false
    }
  } else {
    try {
      await deps.readFile(`${hubDir}/docker-compose.yml`)
      checks.push({ name: 'TRAEFIK_HUB_DIR', ok: true, value: hubDir })
    } catch {
      checks.push({ name: 'TRAEFIK_HUB_DIR', ok: false, error: `invalid - docker-compose.yml not found at ${hubDir}` })
      allOk = false
    }
  }

  // Check TRAEFIK_CONFIG_DIR
  const configDir = deps.configDir
  if (!configDir) {
    try {
      await deps.readFile(`${deps.defaultConfigDir}/traefik.yml`)
      checks.push({ name: 'TRAEFIK_CONFIG_DIR', ok: true, value: deps.defaultConfigDir, isDefault: true })
    } catch {
      checks.push({ name: 'TRAEFIK_CONFIG_DIR', ok: false, error: 'not set and default path invalid' })
      allOk = false
    }
  } else {
    try {
      await deps.readFile(`${configDir}/traefik.yml`)
      checks.push({ name: 'TRAEFIK_CONFIG_DIR', ok: true, value: configDir })
    } catch {
      checks.push({ name: 'TRAEFIK_CONFIG_DIR', ok: false, error: 'invalid - traefik.yml not found' })
      allOk = false
    }
  }

  // API URL is always reported as ok (just informational)
  checks.push({ name: 'TRAEFIK_API_URL', ok: true, value: deps.apiUrl })

  return { checks, allOk }
}

/**
 * Format setup check results as markdown
 */
export function formatSetupCheckResults(results: { checks: SetupCheckResult[]; allOk: boolean }): string {
  const lines: string[] = ['# MCP Configuration Check\n']

  for (const check of results.checks) {
    if (check.ok) {
      const suffix = check.isDefault ? ' (default)' : ''
      lines.push(`✓ ${check.name}: ${check.value}${suffix}`)
    } else {
      lines.push(`✗ ${check.name} ${check.error}`)
    }
  }

  if (!results.allOk) {
    lines.push('\n**Setup required.** Add to your Claude Code MCP config:')
    lines.push('```json')
    lines.push('"env": {')
    lines.push('  "TRAEFIK_HUB_DIR": "/path/to/traefik-hub",')
    lines.push('  "TRAEFIK_CONFIG_DIR": "/path/to/traefik-hub/traefik",')
    lines.push('  "TRAEFIK_API_URL": "http://localhost:8080"')
    lines.push('}')
    lines.push('```')
  } else {
    lines.push('\n**Configuration OK!**')
  }

  return lines.join('\n')
}

/**
 * Parse and modify YAML for adding middleware
 */
export function addMiddlewareToConfig(
  yamlContent: string,
  name: string,
  type: string,
  config: Record<string, unknown>,
  yamlParse: (content: string) => unknown,
  yamlStringify: (data: unknown) => string
): { success: boolean; newContent?: string; error?: string; addedYaml?: string } {
  let data: { http?: { middlewares?: Record<string, unknown> } }
  try {
    data = (yamlParse(yamlContent) as typeof data) || {}
  } catch {
    return { success: false, error: 'Could not parse middlewares.yml' }
  }

  // Ensure structure exists
  if (!data.http) data.http = {}
  if (!data.http.middlewares) data.http.middlewares = {}

  // Check if middleware already exists
  if (data.http.middlewares[name]) {
    return { success: false, error: `Middleware '${name}' already exists. Remove it first or use a different name.` }
  }

  // Add new middleware
  data.http.middlewares[name] = { [type]: config }

  // Generate output
  const addedYaml = yamlStringify({ [name]: { [type]: config } })

  return {
    success: true,
    newContent: yamlStringify(data),
    addedYaml: addedYaml.trim(),
  }
}

/**
 * Update CORS origins in a config object
 */
/**
 * Database image patterns for detection
 */
export const DATABASE_IMAGE_PATTERNS = [
  'postgres', 'postgresql', 'mysql', 'mariadb',
  'mongo', 'mongodb', 'redis', 'memcached',
  'cassandra', 'couchdb', 'influxdb', 'elasticsearch',
  'mssql', 'sqlserver',
]

/**
 * Check if an image name is a database
 */
export function isDatabaseImage(image: string): boolean {
  const lowerImage = image.toLowerCase()
  return DATABASE_IMAGE_PATTERNS.some(pattern => lowerImage.includes(pattern))
}

/**
 * Check if an IP is localhost-only
 */
export function isLocalhostOnly(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === ''
}

/**
 * Container port information for database check
 */
export interface ContainerPortInfo {
  name: string
  image: string
  ports: Array<{ IP: string; PrivatePort: number; PublicPort?: number }>
}

/**
 * Check for database containers with exposed ports
 */
export function checkDatabasePorts(containers: ContainerPortInfo[]): {
  exposedDatabases: string[]
  allSafe: boolean
} {
  const exposedDatabases: string[] = []

  for (const container of containers) {
    if (!isDatabaseImage(container.image)) continue

    const exposedPorts = container.ports.filter(p => {
      if (!p.PublicPort) return false
      return !isLocalhostOnly(p.IP)
    })

    if (exposedPorts.length > 0) {
      const portList = exposedPorts.map(p => `${p.PublicPort}:${p.PrivatePort}`).join(', ')
      exposedDatabases.push(`${container.name} (${container.image}) - ports: ${portList}`)
    }
  }

  return { exposedDatabases, allSafe: exposedDatabases.length === 0 }
}

export function updateCorsOrigins(
  currentOrigins: string[],
  add?: string[],
  remove?: string[]
): { origins: string[]; changes: string[] } {
  const origins = [...currentOrigins]
  const changes: string[] = []

  // Add new origins (deduplicated)
  if (add) {
    for (const origin of add) {
      if (!origins.includes(origin)) {
        origins.push(origin)
        changes.push(`+ ${origin}`)
      }
    }
  }

  // Remove origins
  if (remove) {
    for (const origin of remove) {
      const idx = origins.indexOf(origin)
      if (idx !== -1) {
        origins.splice(idx, 1)
        changes.push(`- ${origin}`)
      }
    }
  }

  return { origins, changes }
}
