# traefik-hub-mcp

MCP server for managing local Traefik reverse proxy from Claude Code.

## Setup

```bash
npm install
npm run build
```

## Add to Claude Code

```json
{
  "mcpServers": {
    "traefik": {
      "command": "node",
      "args": ["/path/to/traefik-hub-mcp/dist/index.js"],
      "env": {
        "TRAEFIK_API_URL": "http://localhost:8080"
      }
    }
  }
}
```

Or for development:

```json
{
  "mcpServers": {
    "traefik": {
      "command": "npx",
      "args": ["tsx", "/path/to/traefik-hub-mcp/src/index.ts"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `traefik_status` | Traefik version and component counts |
| `list_routers` | List HTTP routers |
| `list_services` | List HTTP services |
| `list_middlewares` | List middlewares |
| `get_router` | Get router details |
| `list_containers` | Containers on traefik-public |
| `container_logs` | Get container logs |
| `restart_container` | Restart a container |
| `check_health` | Health check a domain |
