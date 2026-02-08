# extended-gtasks-mcp

Extended fork of [`@alvincrave/gtasks-mcp`](https://www.npmjs.com/package/@alvincrave/gtasks-mcp) — a Google Tasks MCP server for Claude and other AI agents. This fork fixes several bugs and adds new features for production use behind Docker + Tailscale Funnel.

## What's Changed (vs upstream v0.1.2)

| # | Fix | Description |
|---|-----|-------------|
| 1 | **PATCH instead of PUT** | `update` now uses `tasks.tasks.patch()` and strips undefined fields, so marking a task "completed" no longer clears its title |
| 2 | **`list_task_lists`** | New tool to discover task list names and IDs |
| 3 | **`create_task_list`** | New tool to create a task list |
| 4 | **Name-based list lookup** | `taskListId` now accepts a list *name* (case-insensitive) in addition to the opaque Google ID |
| 5 | **Eager token exchange** | `initializeAuth()` forces `getAccessToken()` on startup, eliminating the "first call always fails" race |
| 6 | **Retry wrapper** | Every Google API call is wrapped with 1 automatic retry + exponential backoff for 401/429/500/503/network errors |
| 7 | **Native SSE transport** | Replaced supergateway stdio-to-SSE bridge with the SDK's built-in `SSEServerTransport` + Express — lower latency, one less process |
| 8 | **List filters** | `list` tool now accepts `showCompleted`, `showHidden`, `dueMin`, `dueMax`, `updatedMin`, and `taskListId` for server-side filtering |
| 9 | **`filter_by_tag`** | New tool for bracket-tag convention (`[Life]`, `[House]`, `[Tech]`) filtering in task notes/titles |

## Setup

### 1. Google Cloud credentials

You need a Google Cloud project with the Tasks API enabled and OAuth 2.0 credentials. See the [upstream README](https://github.com/alvinjchoi/gtasks-mcp) for detailed steps.

### 2. Environment file

Copy the example and fill in your credentials:

```bash
cp .env.example .env
# Edit .env with your GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
```

### 3. Run with Docker Compose

```bash
docker compose up -d
docker compose logs --tail 20 gtasks-mcp
# Should see: "Google Tasks MCP Server listening on port 3000"
```

The SSE endpoint is available at `http://localhost:3000/sse`.

### 4. Run locally (development)

```bash
npm install
npm run build
PORT=3000 node dist/index.js
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list` | List tasks with optional filters (`taskListId`, `showCompleted`, `dueMin`, `dueMax`, etc.) |
| `search` | Search tasks by keyword in title/notes |
| `create` | Create a task (supports list name or ID) |
| `update` | Update a task via PATCH (only modifies provided fields) |
| `delete` | Delete a task |
| `clear` | Clear completed tasks from a list |
| `list_task_lists` | List all task lists with IDs and names |
| `create_task_list` | Create a new task list |
| `filter_by_tag` | Find tasks by `[Tag]` convention in notes/title |

## Security

- **Never commit `.env` or credential files** — they're in `.gitignore`
- The `.env.example` file shows the required variables without real values
- Rotate your refresh token periodically
- If exposing via Tailscale Funnel, ensure your Funnel ACLs are properly configured

## License

MIT (same as upstream)
