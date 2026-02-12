#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Docker from "dockerode";
import { readFile, writeFile } from "fs/promises";
import { parse, stringify } from "yaml";
import { exec } from "child_process";
import { promisify } from "util";
import {
  generateLabels,
  getMiddlewareTypes,
  checkSetupConfig,
  formatSetupCheckResults,
  addMiddlewareToConfig,
  updateCorsOrigins,
  checkDatabasePorts,
  type ContainerPortInfo,
} from "./handlers.js";

const execAsync = promisify(exec);

const TRAEFIK_API_URL = process.env.TRAEFIK_API_URL || "http://localhost:8080";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Required env var ${name} is not set`);
    process.exit(1);
  }
  return value;
}

const TRAEFIK_CONFIG_DIR = requireEnv("TRAEFIK_CONFIG_DIR");
const TRAEFIK_HUB_DIR = requireEnv("TRAEFIK_HUB_DIR");
const docker = new Docker();

const server = new Server(
  { name: "traefik-hub-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// Traefik API helper
async function traefikApi(endpoint: string): Promise<unknown> {
  const res = await fetch(`${TRAEFIK_API_URL}/api/${endpoint}`);
  if (!res.ok) throw new Error(`Traefik API error: ${res.status}`);
  return res.json();
}

// Prerequisite check helper
async function checkPrerequisites(): Promise<{ ok: boolean; error?: string }> {
  // Check Docker daemon
  try {
    await docker.ping();
  } catch {
    return { ok: false, error: "Docker daemon not running. Start Docker Desktop first." };
  }

  // Check TRAEFIK_HUB_DIR exists
  try {
    await readFile(`${TRAEFIK_HUB_DIR}/docker-compose.yml`);
  } catch {
    return { ok: false, error: `docker-compose.yml not found at ${TRAEFIK_HUB_DIR}. Check TRAEFIK_HUB_DIR env var.` };
  }

  return { ok: true };
}

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "traefik_status",
      description: "Get Traefik overview - version and component counts",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "list_routers",
      description: "List all HTTP routers with their rules and status",
      inputSchema: {
        type: "object",
        properties: {
          provider: { type: "string", description: "Filter by provider" },
        },
      },
    },
    {
      name: "list_services",
      description: "List all HTTP services registered in Traefik",
      inputSchema: {
        type: "object",
        properties: {
          provider: { type: "string", description: "Filter by provider" },
        },
      },
    },
    {
      name: "list_middlewares",
      description: "List all HTTP middlewares",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_router",
      description: "Get details of a specific router",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Router name (e.g., myapp@docker)" },
        },
        required: ["name"],
      },
    },
    {
      name: "list_containers",
      description: "List Docker containers on traefik-public network",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "container_logs",
      description: "Get logs from a Docker container",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Container name" },
          tail: { type: "number", description: "Lines to return", default: 50 },
        },
        required: ["name"],
      },
    },
    {
      name: "restart_container",
      description: "Restart a Docker container",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Container name" },
        },
        required: ["name"],
      },
    },
    {
      name: "check_health",
      description: "Check if a domain is responding",
      inputSchema: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Domain (e.g., baby.localhost)" },
        },
        required: ["domain"],
      },
    },
    {
      name: "doctor",
      description: "Comprehensive health check of the Traefik stack - checks Docker, network, container, API, ports, and config",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "generate_labels",
      description: "Generate docker-compose traefik labels for a new project",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project/router name (e.g., myapp)" },
          domain: { type: "string", description: "Domain to use (e.g., myapp.localhost)" },
          port: { type: "number", description: "Internal container port" },
          middlewares: {
            type: "array",
            items: { type: "string" },
            description: "Optional array of middleware names (e.g., secure-headers@file)",
          },
        },
        required: ["name", "domain", "port"],
      },
    },
    {
      name: "add_middleware",
      description: "Add a new middleware to traefik/dynamic/middlewares.yml (Traefik hot-reloads automatically)",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Middleware name" },
          type: { type: "string", description: "Middleware type (headers, rateLimit, stripPrefix, etc.)" },
          config: { type: "object", description: "Configuration object for the middleware type" },
        },
        required: ["name", "type", "config"],
      },
    },
    {
      name: "list_middleware_types",
      description: "Show available middleware types with example configurations",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "check_setup",
      description: "Verify MCP configuration - checks that env vars and paths are correctly set",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "start_traefik",
      description: "Start the Traefik stack (docker compose up -d). Requires Docker running.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "stop_traefik",
      description: "Stop the Traefik stack (docker compose down). Requires Docker running.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "create_network",
      description: "Create the traefik-public Docker network. Requires Docker running.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "init_stack",
      description: "Initialize Traefik stack from scratch - creates network and starts containers. Requires Docker running.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
{
      name: "get_cors",
      description: "Show current CORS configuration (allowed origins from cors-dev middleware)",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "update_cors",
      description: "Add or remove origins from the cors-dev middleware",
      inputSchema: {
        type: "object",
        properties: {
          add: { type: "array", items: { type: "string" }, description: "Origins to add (e.g., http://myapp.localhost)" },
          remove: { type: "array", items: { type: "string" }, description: "Origins to remove" },
        },
      },
    },
  ],
}));

// Tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "traefik_status":
        return await handleTraefikStatus();
      case "list_routers":
        return await handleListRouters(args.provider as string | undefined);
      case "list_services":
        return await handleListServices(args.provider as string | undefined);
      case "list_middlewares":
        return await handleListMiddlewares();
      case "get_router":
        return await handleGetRouter(args.name as string);
      case "list_containers":
        return await handleListContainers();
      case "container_logs":
        return await handleContainerLogs(args.name as string, (args.tail as number) || 50);
      case "restart_container":
        return await handleRestartContainer(args.name as string);
      case "check_health":
        return await handleCheckHealth(args.domain as string);
      case "doctor":
        return await handleDoctor();
      case "generate_labels":
        return await handleGenerateLabels(
          args.name as string,
          args.domain as string,
          args.port as number,
          args.middlewares as string[] | undefined
        );
      case "add_middleware":
        return await handleAddMiddleware(
          args.name as string,
          args.type as string,
          args.config as Record<string, unknown>
        );
      case "list_middleware_types":
        return await handleListMiddlewareTypes();
      case "check_setup":
        return await handleCheckSetup();
      case "start_traefik":
        return await handleStartTraefik();
      case "stop_traefik":
        return await handleStopTraefik();
      case "create_network":
        return await handleCreateNetwork();
      case "init_stack":
        return await handleInitStack();
      case "get_cors":
        return await handleGetCors();
      case "update_cors":
        return await handleUpdateCors(
          args.add as string[] | undefined,
          args.remove as string[] | undefined
        );
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Error: ${msg}` }] };
  }
});

async function handleTraefikStatus() {
  const overview = (await traefikApi("overview")) as {
    http?: { routers?: { total?: number }; services?: { total?: number }; middlewares?: { total?: number } };
  };
  const version = (await traefikApi("version")) as { Version?: string };

  const text = `# Traefik Status

**Version**: ${version.Version || "unknown"}

| Component | Count |
|-----------|-------|
| Routers | ${overview.http?.routers?.total || 0} |
| Services | ${overview.http?.services?.total || 0} |
| Middlewares | ${overview.http?.middlewares?.total || 0} |

**Dashboard**: http://traefik.localhost`;

  return { content: [{ type: "text", text }] };
}

async function handleListRouters(provider?: string) {
  let routers = (await traefikApi("http/routers")) as Array<{
    name?: string;
    rule?: string;
    service?: string;
    status?: string;
    provider?: string;
  }>;

  if (provider) {
    routers = routers.filter((r) => r.provider === provider);
  }

  if (!routers.length) {
    return { content: [{ type: "text", text: "No routers found." }] };
  }

  const lines = ["# HTTP Routers\n", "| Name | Rule | Service | Status |", "|------|------|---------|--------|"];
  for (const r of routers) {
    lines.push(`| ${r.name} | \`${r.rule}\` | ${r.service} | ${r.status} |`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleListServices(provider?: string) {
  let services = (await traefikApi("http/services")) as Array<{
    name?: string;
    type?: string;
    status?: string;
    provider?: string;
    loadBalancer?: { servers?: Array<{ url?: string }> };
  }>;

  if (provider) {
    services = services.filter((s) => s.provider === provider);
  }

  if (!services.length) {
    return { content: [{ type: "text", text: "No services found." }] };
  }

  const lines = ["# HTTP Services\n", "| Name | Type | Status |", "|------|------|--------|"];
  for (const s of services) {
    lines.push(`| ${s.name} | ${s.type} | ${s.status} |`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleListMiddlewares() {
  const middlewares = (await traefikApi("http/middlewares")) as Array<{
    name?: string;
    type?: string;
    provider?: string;
  }>;

  if (!middlewares.length) {
    return { content: [{ type: "text", text: "No middlewares found." }] };
  }

  const lines = ["# HTTP Middlewares\n", "| Name | Type | Provider |", "|------|------|----------|"];
  for (const m of middlewares) {
    lines.push(`| ${m.name} | ${m.type} | ${m.provider} |`);
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleGetRouter(name: string) {
  const router = (await traefikApi(`http/routers/${name}`)) as {
    status?: string;
    provider?: string;
    rule?: string;
    service?: string;
    entryPoints?: string[];
    middlewares?: string[];
  };

  const text = `# Router: ${name}

**Status**: ${router.status}
**Provider**: ${router.provider}
**Rule**: \`${router.rule}\`
**Service**: ${router.service}
**EntryPoints**: ${router.entryPoints?.join(", ") || "none"}
**Middlewares**: ${router.middlewares?.join(", ") || "none"}`;

  return { content: [{ type: "text", text }] };
}

async function handleListContainers() {
  try {
    const network = docker.getNetwork("traefik-public");
    const info = await network.inspect();
    const containers = info.Containers || {};

    if (!Object.keys(containers).length) {
      return { content: [{ type: "text", text: "No containers on traefik-public network." }] };
    }

    const lines = ["# Containers on traefik-public\n", "| Name | IPv4 |", "|------|------|"];
    for (const [, c] of Object.entries(containers)) {
      const container = c as { Name?: string; IPv4Address?: string };
      const ip = container.IPv4Address?.split("/")[0] || "";
      lines.push(`| ${container.Name} | ${ip} |`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch {
    return {
      content: [{ type: "text", text: "Network 'traefik-public' not found. Start Traefik first." }],
    };
  }
}

async function handleContainerLogs(name: string, tail: number) {
  try {
    const container = docker.getContainer(name);
    const logs = await container.logs({ stdout: true, stderr: true, tail, timestamps: true });
    return { content: [{ type: "text", text: `# Logs: ${name}\n\n\`\`\`\n${logs.toString()}\n\`\`\`` }] };
  } catch {
    return { content: [{ type: "text", text: `Container '${name}' not found.` }] };
  }
}

async function handleRestartContainer(name: string) {
  try {
    const container = docker.getContainer(name);
    await container.restart();
    return { content: [{ type: "text", text: `Container '${name}' restarted.` }] };
  } catch {
    return { content: [{ type: "text", text: `Container '${name}' not found.` }] };
  }
}

async function handleCheckHealth(domain: string) {
  try {
    const res = await fetch(`http://${domain}`, { signal: AbortSignal.timeout(5000) });
    const status = res.status < 500 ? "healthy" : "unhealthy";
    return {
      content: [{ type: "text", text: `# Health: ${domain}\n\n**Status**: ${status}\n**HTTP**: ${res.status}` }],
    };
  } catch {
    return { content: [{ type: "text", text: `# Health: ${domain}\n\n**Status**: unreachable` }] };
  }
}

async function handleDoctor() {
  interface Check {
    name: string;
    status: "ok" | "warn" | "fail";
    detail?: string;
    tip?: string;
  }
  const checks: Check[] = [];

  // 1. Docker daemon accessible
  try {
    await docker.ping();
    checks.push({ name: "Docker daemon", status: "ok" });
  } catch {
    checks.push({ name: "Docker daemon", status: "fail", tip: "Start Docker Desktop or docker daemon" });
  }

  // 2. traefik-public network exists
  try {
    const network = docker.getNetwork("traefik-public");
    await network.inspect();
    checks.push({ name: "traefik-public network", status: "ok" });
  } catch {
    checks.push({
      name: "traefik-public network",
      status: "fail",
      tip: "Run: docker network create traefik-public",
    });
  }

  // 3. Traefik container running
  try {
    const containers = await docker.listContainers({ all: false });
    const traefikContainer = containers.find(
      (c) => c.Names.some((n) => n.includes("traefik")) || c.Image.includes("traefik")
    );
    if (traefikContainer) {
      checks.push({ name: "Traefik container", status: "ok", detail: traefikContainer.Names[0] });
    } else {
      checks.push({
        name: "Traefik container",
        status: "fail",
        tip: "Run: cd traefik-hub && docker compose up -d",
      });
    }
  } catch {
    checks.push({ name: "Traefik container", status: "fail", tip: "Could not list containers" });
  }

  // 4. Traefik API responding
  try {
    const res = await fetch(`${TRAEFIK_API_URL}/api/overview`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      checks.push({ name: "Traefik API", status: "ok", detail: TRAEFIK_API_URL });
    } else {
      checks.push({ name: "Traefik API", status: "fail", detail: `HTTP ${res.status}` });
    }
  } catch {
    checks.push({
      name: "Traefik API",
      status: "fail",
      tip: `API not responding at ${TRAEFIK_API_URL}`,
    });
  }

  // 5. Port 80 check (via Traefik entrypoint)
  try {
    const res = await fetch("http://localhost:80", { signal: AbortSignal.timeout(3000) });
    // Any response means port 80 is handled by Traefik
    checks.push({ name: "Port 80", status: "ok", detail: `HTTP ${res.status}` });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("ECONNREFUSED")) {
      checks.push({ name: "Port 80", status: "fail", tip: "Port 80 not listening - Traefik may not be running" });
    } else {
      checks.push({ name: "Port 80", status: "ok", detail: "Listening (connection reset/timeout is ok)" });
    }
  }

  // 6. Dashboard accessible
  try {
    const res = await fetch("http://traefik.localhost", { signal: AbortSignal.timeout(3000) });
    if (res.ok || res.status === 200) {
      checks.push({ name: "Dashboard (traefik.localhost)", status: "ok" });
    } else {
      checks.push({ name: "Dashboard (traefik.localhost)", status: "fail", detail: `HTTP ${res.status}` });
    }
  } catch {
    checks.push({
      name: "Dashboard (traefik.localhost)",
      status: "fail",
      tip: "Dashboard not accessible - check Traefik config",
    });
  }

  // 7. Config files exist
  try {
    await readFile(`${TRAEFIK_CONFIG_DIR}/traefik.yml`, "utf-8");
    await readFile(`${TRAEFIK_CONFIG_DIR}/dynamic/middlewares.yml`, "utf-8");
    checks.push({ name: "Config files", status: "ok", detail: TRAEFIK_CONFIG_DIR });
  } catch {
    checks.push({
      name: "Config files",
      status: "fail",
      tip: `Config not found at ${TRAEFIK_CONFIG_DIR}`,
    });
  }

  // 8. Active routers/services count
  try {
    const overview = (await traefikApi("overview")) as {
      http?: { routers?: { total?: number }; services?: { total?: number } };
    };
    const routers = overview.http?.routers?.total || 0;
    const services = overview.http?.services?.total || 0;
    checks.push({
      name: "Active routes",
      status: "ok",
      detail: `${routers} routers, ${services} services`,
    });
  } catch {
    checks.push({ name: "Active routes", status: "fail", tip: "Could not fetch from Traefik API" });
  }

  // 9. Check for database containers with exposed ports
  try {
    const allContainers = await docker.listContainers({ all: false });
    const containerInfo: ContainerPortInfo[] = allContainers.map(c => ({
      name: c.Names[0]?.replace(/^\//, '') || 'unknown',
      image: c.Image,
      ports: c.Ports || []
    }));

    const dbCheck = checkDatabasePorts(containerInfo);

    if (!dbCheck.allSafe) {
      checks.push({
        name: "Database ports",
        status: "warn",
        detail: `${dbCheck.exposedDatabases.length} database(s) with exposed ports`,
        tip: `Consider removing host port mappings. Use \`docker compose exec\` instead.`
      });
    } else {
      checks.push({
        name: "Database ports",
        status: "ok",
        detail: "No databases with exposed host ports"
      });
    }
  } catch {
    // Non-fatal - skip if container listing fails
  }

  // Format output
  const lines = ["# Traefik Stack Health Check\n"];
  let allOk = true;
  let hasWarnings = false;
  for (const check of checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "⚠" : "✗";
    let line = `${icon} **${check.name}**`;
    if (check.detail) line += ` - ${check.detail}`;
    if (check.status === "fail") {
      allOk = false;
      if (check.tip) line += `\n  └─ Tip: ${check.tip}`;
    } else if (check.status === "warn") {
      hasWarnings = true;
      if (check.tip) line += `\n  └─ Tip: ${check.tip}`;
    }
    lines.push(line);
  }

  lines.push("");
  if (!allOk) {
    lines.push("**Some checks failed.** See tips above.");
  } else if (hasWarnings) {
    lines.push("**All checks passed with warnings.** See tips above.");
  } else {
    lines.push("**All checks passed!**");
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

async function handleGenerateLabels(
  name: string,
  domain: string,
  port: number,
  middlewares?: string[]
) {
  const output = generateLabels(name, domain, port, middlewares);
  return { content: [{ type: "text", text: output }] };
}

async function handleAddMiddleware(
  name: string,
  type: string,
  config: Record<string, unknown>
) {
  const middlewaresPath = `${TRAEFIK_CONFIG_DIR}/dynamic/middlewares.yml`;

  // Read current config
  let content: string;
  try {
    content = await readFile(middlewaresPath, "utf-8");
  } catch {
    return {
      content: [{ type: "text", text: `Error: Could not read ${middlewaresPath}` }],
    };
  }

  const result = addMiddlewareToConfig(content, name, type, config, parse, stringify);

  if (!result.success) {
    return { content: [{ type: "text", text: `Error: ${result.error}` }] };
  }

  // Write back
  try {
    await writeFile(middlewaresPath, result.newContent!);
  } catch {
    return { content: [{ type: "text", text: `Error: Could not write to ${middlewaresPath}` }] };
  }

  return {
    content: [
      {
        type: "text",
        text: `# Middleware Added

Added \`${name}\` to middlewares.yml:

\`\`\`yaml
${result.addedYaml}
\`\`\`

Traefik will hot-reload this automatically.

**Usage in docker-compose labels:**
\`\`\`
traefik.http.routers.myapp.middlewares=${name}@file
\`\`\``,
      },
    ],
  };
}

async function handleListMiddlewareTypes() {
  return { content: [{ type: "text", text: getMiddlewareTypes() }] };
}

async function handleCheckSetup() {
  const results = await checkSetupConfig({
    hubDir: process.env.TRAEFIK_HUB_DIR,
    configDir: process.env.TRAEFIK_CONFIG_DIR,
    apiUrl: TRAEFIK_API_URL,
    defaultHubDir: TRAEFIK_HUB_DIR,
    defaultConfigDir: TRAEFIK_CONFIG_DIR,
    readFile: (path: string) => readFile(path, "utf-8"),
  });
  return { content: [{ type: "text", text: formatSetupCheckResults(results) }] };
}

async function handleStartTraefik() {
  const prereq = await checkPrerequisites();
  if (!prereq.ok) {
    return { content: [{ type: "text", text: `# Cannot Start\n\n${prereq.error}` }] };
  }

  try {
    const { stdout, stderr } = await execAsync("docker compose up -d", {
      cwd: TRAEFIK_HUB_DIR
    });
    return { content: [{ type: "text", text: `# Traefik Started\n\n${stdout || "Started successfully."}\n${stderr ? `\nWarnings:\n${stderr}` : ""}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Failed to start: ${err}` }] };
  }
}

async function handleStopTraefik() {
  const prereq = await checkPrerequisites();
  if (!prereq.ok) {
    return { content: [{ type: "text", text: `# Cannot Stop\n\n${prereq.error}` }] };
  }

  try {
    const { stdout } = await execAsync("docker compose down", { cwd: TRAEFIK_HUB_DIR });
    return { content: [{ type: "text", text: `# Traefik Stopped\n\n${stdout || "Stopped successfully."}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Failed to stop: ${err}` }] };
  }
}

async function handleCreateNetwork() {
  try {
    await docker.createNetwork({ Name: "traefik-public", Driver: "bridge" });
    return { content: [{ type: "text", text: "Network 'traefik-public' created." }] };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("already exists")) {
      return { content: [{ type: "text", text: "Network 'traefik-public' already exists." }] };
    }
    return { content: [{ type: "text", text: `Failed: ${errMsg}` }] };
  }
}

async function handleInitStack() {
  const steps: string[] = ["# Initializing Traefik Stack\n"];

  // Step 1: Check Docker
  try {
    await docker.ping();
    steps.push("✓ Docker daemon running");
  } catch {
    steps.push("✗ Docker daemon not running - start Docker first");
    return { content: [{ type: "text", text: steps.join("\n") }] };
  }

  // Step 2: Create network
  try {
    await docker.createNetwork({ Name: "traefik-public", Driver: "bridge" });
    steps.push("✓ Created traefik-public network");
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("already exists")) {
      steps.push("✓ traefik-public network exists");
    } else {
      steps.push(`✗ Network creation failed: ${errMsg}`);
    }
  }

  // Step 3: Start Traefik
  try {
    await execAsync("docker compose up -d", { cwd: TRAEFIK_HUB_DIR });
    steps.push("✓ Traefik containers started");
  } catch (err) {
    steps.push(`✗ Failed to start: ${err}`);
    return { content: [{ type: "text", text: steps.join("\n") }] };
  }

  // Step 4: Wait and verify
  await new Promise(r => setTimeout(r, 2000));
  try {
    const res = await fetch(`${TRAEFIK_API_URL}/api/overview`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      steps.push("✓ Traefik API responding");
      steps.push("\n**Stack ready!** Dashboard: http://traefik.localhost");
    }
  } catch {
    steps.push("⚠ Traefik started but API not responding yet - wait a few seconds");
  }

  return { content: [{ type: "text", text: steps.join("\n") }] };
}

async function handleGetCors() {
  const middlewaresPath = `${TRAEFIK_CONFIG_DIR}/dynamic/middlewares.yml`;

  try {
    const content = await readFile(middlewaresPath, "utf-8");
    const data = parse(content) as {
      http?: {
        middlewares?: {
          "cors-dev"?: {
            headers?: {
              accessControlAllowOriginList?: string[];
              accessControlAllowMethods?: string[];
              accessControlAllowHeaders?: string[];
            };
          };
        };
      };
    };

    const corsConfig = data.http?.middlewares?.["cors-dev"]?.headers;
    if (!corsConfig) {
      return { content: [{ type: "text", text: "No cors-dev middleware found." }] };
    }

    const origins = corsConfig.accessControlAllowOriginList || [];
    const methods = corsConfig.accessControlAllowMethods || [];

    let text = "# CORS Configuration (cors-dev)\n\n";
    text += "**Allowed Origins:**\n";
    if (origins.length) {
      text += origins.map(o => `- ${o}`).join("\n");
    } else {
      text += "- (none configured)";
    }
    text += "\n\n**Allowed Methods:**\n";
    text += methods.join(", ") || "(none)";
    text += "\n\n**Usage:** Add `cors-dev@file` to router middlewares";

    return { content: [{ type: "text", text }] };
  } catch {
    return { content: [{ type: "text", text: "Error: Could not read middlewares.yml" }] };
  }
}

async function handleUpdateCors(add?: string[], remove?: string[]) {
  const middlewaresPath = `${TRAEFIK_CONFIG_DIR}/dynamic/middlewares.yml`;

  let content: string;
  try {
    content = await readFile(middlewaresPath, "utf-8");
  } catch {
    return { content: [{ type: "text", text: "Error: Could not read middlewares.yml" }] };
  }

  const data = parse(content) as {
    http?: {
      middlewares?: {
        "cors-dev"?: {
          headers?: {
            accessControlAllowOriginList?: string[];
            [key: string]: unknown;
          };
          [key: string]: unknown;
        };
        [key: string]: unknown;
      };
    };
  };

  // Ensure cors-dev middleware exists
  if (!data.http?.middlewares?.["cors-dev"]?.headers) {
    return { content: [{ type: "text", text: "Error: cors-dev middleware not found in middlewares.yml" }] };
  }

  const currentOrigins = data.http.middlewares["cors-dev"].headers.accessControlAllowOriginList || [];
  const { origins, changes } = updateCorsOrigins(currentOrigins, add, remove);

  if (changes.length === 0) {
    return { content: [{ type: "text", text: "No changes made (origins already in desired state)." }] };
  }

  // Update and save
  data.http.middlewares["cors-dev"].headers.accessControlAllowOriginList = origins;
  await writeFile(middlewaresPath, stringify(data));

  let text = "# CORS Updated\n\n**Changes:**\n";
  text += changes.map(c => `\`${c}\``).join("\n");
  text += "\n\n**Current allowed origins:**\n";
  text += origins.map(o => `- ${o}`).join("\n");
  text += "\n\nTraefik will hot-reload automatically.";

  return { content: [{ type: "text", text }] };
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
