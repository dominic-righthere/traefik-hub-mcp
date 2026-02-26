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

/**
 * Known Traefik log error patterns and their meanings
 */
export const TRAEFIK_LOG_ERROR_PATTERNS: Array<{
  pattern: RegExp
  message: string
  severity: 'fail' | 'warn'
}> = [
  {
    pattern: /Error response from daemon:\s*"/,
    message: 'Docker socket proxy returning empty errors (broken in-VM proxy)',
    severity: 'fail',
  },
  {
    pattern: /connection refused/i,
    message: 'Connection refused to backend service',
    severity: 'warn',
  },
  {
    pattern: /permission denied.*docker\.sock/i,
    message: 'Docker socket permission denied',
    severity: 'fail',
  },
  {
    pattern: /no such host/i,
    message: 'DNS resolution failure',
    severity: 'warn',
  },
]

/**
 * Analyze Traefik log text for known error patterns
 */
export interface LogAnalysisResult {
  status: 'ok' | 'warn' | 'fail'
  matches: Array<{ message: string; severity: 'fail' | 'warn'; count: number }>
}

export function analyzeTraefikLogs(logText: string): LogAnalysisResult {
  const matches: LogAnalysisResult['matches'] = []

  for (const { pattern, message, severity } of TRAEFIK_LOG_ERROR_PATTERNS) {
    const lines = logText.split('\n')
    const count = lines.filter(line => pattern.test(line)).length
    if (count > 0) {
      matches.push({ message, severity, count })
    }
  }

  if (matches.length === 0) {
    return { status: 'ok', matches: [] }
  }

  const hasFail = matches.some(m => m.severity === 'fail')
  return { status: hasFail ? 'fail' : 'warn', matches }
}

// --- Update Check Types & Functions ---

export interface SemVer {
  major: number
  minor: number
  patch: number
  raw: string
}

export type UpdateType = 'major' | 'minor' | 'patch' | 'none' | 'downgrade'

export interface UpdateCheckInput {
  runningVersion: string | null
  dockerComposeContent: string | null
  latestRelease: { tag: string; body: string } | null
}

export interface UpdateAnalysis {
  running: SemVer | null
  pinned: SemVer | null
  latest: SemVer | null
  updateType: UpdateType | null
  safetyLevel: 'up-to-date' | 'safe' | 'generally-safe' | 'review-required' | 'error'
  releaseNotes: string | null
}

export function parseSemver(input: string): SemVer | null {
  const match = input.match(/v?(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return null
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3] ?? '0', 10),
    raw: input,
  }
}

export function parsePinnedVersion(dockerComposeContent: string): SemVer | null {
  const match = dockerComposeContent.match(/image:\s*traefik:(\S+)/)
  if (!match) return null
  const tag = match[1]
  if (tag === 'latest') return null
  return parseSemver(tag)
}

export function compareVersions(from: SemVer, to: SemVer): UpdateType {
  if (to.major > from.major) return 'major'
  if (to.major < from.major) return 'downgrade'
  if (to.minor > from.minor) return 'minor'
  if (to.minor < from.minor) return 'downgrade'
  if (to.patch > from.patch) return 'patch'
  if (to.patch < from.patch) return 'downgrade'
  return 'none'
}

export function analyzeUpdate(input: UpdateCheckInput): UpdateAnalysis {
  const running = input.runningVersion ? parseSemver(input.runningVersion) : null
  const pinned = input.dockerComposeContent ? parsePinnedVersion(input.dockerComposeContent) : null
  const latest = input.latestRelease ? parseSemver(input.latestRelease.tag) : null
  const releaseNotes = input.latestRelease?.body ?? null

  const source = running || pinned
  if (!source || !latest) {
    return { running, pinned, latest, updateType: null, safetyLevel: 'error', releaseNotes }
  }

  const updateType = compareVersions(source, latest)

  let safetyLevel: UpdateAnalysis['safetyLevel']
  switch (updateType) {
    case 'none':
    case 'downgrade':
      safetyLevel = 'up-to-date'
      break
    case 'patch':
      safetyLevel = 'safe'
      break
    case 'minor':
      safetyLevel = 'generally-safe'
      break
    case 'major':
      safetyLevel = 'review-required'
      break
  }

  return { running, pinned, latest, updateType, safetyLevel, releaseNotes }
}

export function formatUpdateReport(analysis: UpdateAnalysis): string {
  const lines: string[] = ['# Traefik Update Check\n']

  // Version table
  lines.push('| Source | Version |')
  lines.push('|--------|---------|')
  lines.push(`| Running | ${analysis.running?.raw ?? 'unknown'} |`)
  lines.push(`| Pinned (docker-compose) | ${analysis.pinned?.raw ?? 'unknown'} |`)
  lines.push(`| Latest (GitHub) | ${analysis.latest?.raw ?? 'unknown'} |`)
  lines.push('')

  // Safety badge
  const badges: Record<UpdateAnalysis['safetyLevel'], string> = {
    'up-to-date': '✓ **Up to date** — no action needed',
    'safe': '✓ **Safe to update** — patch release (bug fixes only)',
    'generally-safe': '⚠ **Generally safe** — minor release (new features, backwards compatible)',
    'review-required': '⚠ **Review required** — major release (may contain breaking changes)',
    'error': '✗ **Could not determine** — version information unavailable',
  }
  lines.push(badges[analysis.safetyLevel])
  lines.push('')

  // Pinned vs running mismatch warning
  if (analysis.running && analysis.pinned) {
    const pinnedVsRunning = compareVersions(analysis.pinned, analysis.running)
    if (pinnedVsRunning !== 'none') {
      lines.push(`> **Note:** Running version (${analysis.running.raw}) differs from pinned version (${analysis.pinned.raw}). Consider aligning them.`)
      lines.push('')
    }
  }

  // Update instructions
  if (analysis.safetyLevel !== 'up-to-date' && analysis.safetyLevel !== 'error' && analysis.latest) {
    lines.push('## Update Instructions')
    lines.push('')
    lines.push('```bash')
    lines.push(`# Update docker-compose.yml image tag to traefik:v${analysis.latest.major}.${analysis.latest.minor}.${analysis.latest.patch}`)
    lines.push('# Then restart:')
    lines.push('docker compose pull && docker compose up -d')
    lines.push('```')
    lines.push('')
  }

  // Release notes
  if (analysis.releaseNotes) {
    lines.push('## Latest Release Notes')
    lines.push('')
    const maxLen = 1500
    if (analysis.releaseNotes.length > maxLen) {
      lines.push(analysis.releaseNotes.slice(0, maxLen) + '...')
    } else {
      lines.push(analysis.releaseNotes)
    }
    lines.push('')
  }

  lines.push('[View all releases on GitHub](https://github.com/traefik/traefik/releases)')

  return lines.join('\n')
}

/**
 * Build a Traefik Host rule for domain aliases.
 * Takes a localhost hostname (e.g. "baby.localhost" or "api.baby.localhost")
 * and returns a rule matching the same subdomain on each alias domain.
 */
export function buildDomainRule(localhostHost: string, domainAliases: string[]): string {
  const subdomain = localhostHost.replace(/\.localhost$/, '')
  const hosts = domainAliases.map(alias => `Host(\`${subdomain}.${alias}\`)`)
  return hosts.join(' || ')
}

/**
 * Add a domain route to multi-domain.yml content
 */
export function addDomainRoute(
  yamlContent: string,
  routerName: string,
  localhostHost: string,
  serviceName: string,
  domainAliases: string[],
  yamlParse: (content: string) => unknown,
  yamlStringify: (data: unknown) => string
): { success: boolean; newContent?: string; error?: string } {
  let data: { http?: { routers?: Record<string, unknown> } }
  try {
    data = (yamlParse(yamlContent) as typeof data) || {}
  } catch {
    data = {}
  }

  if (!data.http) data.http = {}
  if (!data.http.routers) data.http.routers = {}

  if (data.http.routers[routerName]) {
    return { success: false, error: `Router '${routerName}' already exists` }
  }

  const rule = buildDomainRule(localhostHost, domainAliases)
  data.http.routers[routerName] = {
    rule,
    service: `${serviceName}@docker`,
    entryPoints: ['web'],
  }

  return { success: true, newContent: yamlStringify(data) }
}

/**
 * Remove a domain route from multi-domain.yml content
 */
export function removeDomainRoute(
  yamlContent: string,
  routerName: string,
  yamlParse: (content: string) => unknown,
  yamlStringify: (data: unknown) => string
): { success: boolean; newContent?: string; error?: string } {
  let data: { http?: { routers?: Record<string, unknown> } }
  try {
    data = (yamlParse(yamlContent) as typeof data) || {}
  } catch {
    return { success: false, error: 'Could not parse multi-domain.yml' }
  }

  if (!data.http?.routers?.[routerName]) {
    return { success: false, error: `Router '${routerName}' not found` }
  }

  delete data.http.routers[routerName]

  return { success: true, newContent: yamlStringify(data) }
}

/**
 * List all domain routes from multi-domain.yml content
 */
export function listDomainRoutes(
  yamlContent: string,
  yamlParse: (content: string) => unknown
): Array<{ name: string; rule: string; service: string }> {
  let data: { http?: { routers?: Record<string, { rule?: string; service?: string }> } }
  try {
    data = (yamlParse(yamlContent) as typeof data) || {}
  } catch {
    return []
  }

  const routers = data.http?.routers || {}
  return Object.entries(routers).map(([name, config]) => ({
    name,
    rule: config.rule || '',
    service: config.service || '',
  }))
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
