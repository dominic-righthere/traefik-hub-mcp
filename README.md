# traefik-hub-mcp

MCP server for managing a local Traefik reverse proxy from Claude Code. Inspect routers, services, and middlewares; manage Docker containers; health-check domains; and configure CORS and middleware -- all without leaving your editor.

## Installation

```bash
# Run directly (recommended for Claude Code)
npx traefik-hub-mcp

# Or install globally
npm install -g traefik-hub-mcp
```

## Prerequisites

- **Node.js** >= 18
- **Docker** running (Docker Desktop or daemon)
- A **Traefik** stack managed via `docker-compose.yml` (see [traefik-hub](https://github.com/dominic-righthere/traefik-hub) for a ready-made setup)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TRAEFIK_CONFIG_DIR` | Yes | -- | Path to Traefik config directory (contains `traefik.yml` and `dynamic/`) |
| `TRAEFIK_HUB_DIR` | Yes | -- | Path to the Traefik Hub repo root (contains `docker-compose.yml`) |
| `TRAEFIK_API_URL` | No | `http://localhost:8080` | Traefik API base URL |

## Claude Code Setup

Add to your Claude Code MCP configuration (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "traefik": {
      "command": "npx",
      "args": ["-y", "traefik-hub-mcp"],
      "env": {
        "TRAEFIK_HUB_DIR": "/path/to/traefik-hub",
        "TRAEFIK_CONFIG_DIR": "/path/to/traefik-hub/traefik",
        "TRAEFIK_API_URL": "http://localhost:8080"
      }
    }
  }
}
```

## Tools

### Traefik API

| Tool | Description |
|------|-------------|
| `traefik_status` | Traefik version and component counts |
| `list_routers` | List HTTP routers (optionally filter by provider) |
| `list_services` | List HTTP services (optionally filter by provider) |
| `list_middlewares` | List all HTTP middlewares |
| `get_router` | Get details of a specific router |

### Docker

| Tool | Description |
|------|-------------|
| `list_containers` | List containers on the `traefik-public` network |
| `container_logs` | Get logs from a container |
| `restart_container` | Restart a container |

### Health & Diagnostics

| Tool | Description |
|------|-------------|
| `check_health` | Check if a domain is responding |
| `doctor` | Comprehensive stack health check (Docker, network, container, API, ports, config) |
| `check_setup` | Verify MCP env vars and paths are correctly set |

### Stack Management

| Tool | Description |
|------|-------------|
| `start_traefik` | Start the Traefik stack (`docker compose up -d`) |
| `stop_traefik` | Stop the Traefik stack (`docker compose down`) |
| `create_network` | Create the `traefik-public` Docker network |
| `init_stack` | Initialize from scratch (create network + start containers) |

### Configuration

| Tool | Description |
|------|-------------|
| `generate_labels` | Generate docker-compose Traefik labels for a new project |
| `add_middleware` | Add a middleware to `middlewares.yml` (Traefik hot-reloads) |
| `list_middleware_types` | Show available middleware types with example configs |
| `get_cors` | Show current CORS configuration |
| `update_cors` | Add or remove origins from the `cors-dev` middleware |

## Development

```bash
git clone https://github.com/dominic-righthere/traefik-hub-mcp.git
cd traefik-hub-mcp
npm install
npm run build
npm test
```

## License

MIT
