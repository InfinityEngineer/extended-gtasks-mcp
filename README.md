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
| 7 | **Dual transports** | StreamableHTTP (`/mcp`) + legacy SSE (`/sse`) — no supergateway needed |
| 8 | **List filters** | `list` tool now accepts `showCompleted`, `showHidden`, `dueMin`, `dueMax`, `updatedMin`, and `taskListId` for server-side filtering |
| 9 | **`filter_by_tag`** | New tool for bracket-tag convention (`[Life]`, `[House]`, `[Tech]`) filtering in task notes/titles |
| 10 | **Tag management** | `add_tag` / `remove_tag` tools to modify tags without clobbering notes |
| 11 | **`list_summary`** | Token-efficient listing (title + status + due + id only) |
| 12 | **`due_soon`** | Find tasks due within N days or a date range |
| 13 | **`move_task`** | Move a task between lists in one call using native API |
| 14 | **`server_info`** | Diagnostic tool returning version, SDK, protocol, tool list, session count |
| 15 | **`/health` endpoint** | Plain HTTP health check with full server diagnostics |

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
# Should see: "Google Tasks MCP Server v1.2.0 listening on port 3000"
```

Endpoints:
- **StreamableHTTP (modern):** `http://localhost:3000/mcp`
- **SSE (legacy):** `http://localhost:3000/sse`
- **Health check:** `http://localhost:3000/health`

### 4. Run locally (development)

```bash
npm install
npm run build
PORT=3000 node dist/index.js
```

## Available Tools (15)

| Tool | Description |
|------|-------------|
| `list` | List tasks with full details and optional filters (`taskListId`, `showCompleted`, `dueMin`, `dueMax`, etc.) |
| `list_summary` | List tasks with minimal detail (title, status, due, id) — much more token-efficient |
| `search` | Search tasks by keyword in title/notes |
| `create` | Create a task (supports list name or ID) |
| `update` | Update a task via PATCH (only modifies provided fields) |
| `delete` | Delete a task |
| `clear` | Clear completed tasks from a list |
| `move_task` | Move a task from one list to another in a single call |
| `list_task_lists` | List all task lists with IDs and names |
| `create_task_list` | Create a new task list |
| `filter_by_tag` | Find tasks by `[Tag]` convention in notes/title |
| `due_soon` | Find tasks due within N days or explicit date range |
| `add_tag` | Add a `[Tag]` to a task's notes without overwriting existing content |
| `remove_tag` | Remove a `[Tag]` from a task's notes |
| `server_info` | Server diagnostics (version, tools, sessions, auth status) |

## Claude.ai Custom Instructions

Add this to your Claude.ai custom instructions to enable efficient, natural task management:

```
You have access to a Google Tasks MCP server. Use it to help me manage tasks when I ask.

RULES:
- NEVER create, modify, or delete tasks unless I explicitly ask you to.
- If during conversation you notice something I should track, ask me at the end of your
  message: "Want me to add [description] to your [list name] list?" — only act if I confirm.
- When I do ask you to work with tasks, confirm what you did briefly.

EFFICIENCY:
- Use list_summary instead of list for quick overviews (saves tokens).
- Use due_soon with days parameter for date-range queries (e.g. days=7 for this week).
- Use move_task to move tasks between lists in one call.
- Use add_tag/remove_tag instead of update when only changing tags.
- Use filter_by_tag to find tasks by category.
- Keep tag names short and consistent: [Work], [Home], [Urgent], [Blocked], etc.
```

## Verification Prompts

### Minimum Test (quick connectivity check)

```
Ignore any prior context about Google Tasks tools or MCP servers from earlier
in this conversation. Start fresh.

Call the "server_info" tool right now. If that tool doesn't exist, list every
tool name you can see from the Google Tasks MCP integration (just the names,
one per line).

Then tell me:
1. How many tools total do you see?
2. Do you see "list_task_lists" and "server_info" as available tools? Yes or no.
3. What URL/endpoint are you connecting to for this MCP server?

Keep your answer short — just the raw tool output and the 3 answers above.
```

**Expected:** 15 tools, both `list_task_lists` and `server_info` present, server v1.2.0.

### Maximum Test (full tool verification)

```
Ignore any prior context about Google Tasks from this conversation.
Run each step below IN ORDER, reporting results as you go.
Use the Google Tasks MCP tools — do NOT simulate or skip any step.

## Step 1: Diagnostics
Call `server_info`. Report: version, toolCount, and the full tools list.

## Step 2: List existing task lists
Call `list_task_lists`. Report: how many lists, and their names. (DO NOT modify these.)

## Step 3: Create a test list
Call `create_task_list` with title "[TEST] MCP Verification". Report: the new list ID.

## Step 4: Create a second test list
Call `create_task_list` with title "[TEST] Move Target". Report: the new list ID.

## Step 5: Create a test task
Call `create` in the "[TEST] MCP Verification" list with:
- title: "Verify MCP tools"
- notes: "[TestTag] Created by automated MCP verification"
- due: "2099-12-31T00:00:00.000Z"
Report: the new task ID.

## Step 6: List tasks (summary)
Call `list_summary` with taskListId "[TEST] MCP Verification". Report: task count and titles.

## Step 7: Update the task
Call `update` with the task ID from Step 5:
- title: "Verify MCP tools (updated)"
Report: confirmation message.

## Step 8: Search
Call `search` with query "Verify MCP". Report: how many results and the matching title(s).

## Step 9: Filter by tag
Call `filter_by_tag` with tag "TestTag" and taskListId "[TEST] MCP Verification".
Report: match count and task title(s).

## Step 10: Add a tag
Call `add_tag` with the task ID from Step 5, tag "Verified",
and taskListId "[TEST] MCP Verification". Report: confirmation.

## Step 11: Remove a tag
Call `remove_tag` with the task ID from Step 5, tag "TestTag",
and taskListId "[TEST] MCP Verification". Report: confirmation.

## Step 12: Move task
Call `move_task` with the task ID from Step 5,
fromList "[TEST] MCP Verification", toList "[TEST] Move Target".
Report: confirmation.

## Step 13: Due soon
Call `due_soon` with days 365 and taskListId "[TEST] Move Target".
Report: count and any tasks found.

## Step 14: Delete test task
Call `delete` with the task ID from Step 5 and taskListId "[TEST] Move Target".
Report: confirmation.

## Step 15: Clean up
Call `clear` with taskListId "[TEST] MCP Verification". Report: confirmation.

## Summary
After all steps, print a table:
| Step | Tool | Result |
with a pass/fail on each step.

Note: This creates "[TEST] MCP Verification" and "[TEST] Move Target" task lists
that can be deleted manually afterward from Google Tasks.
```

**Expected:** 15/15 steps pass.

## Security

- **Never commit `.env` or credential files** — they're in `.gitignore`
- The `.env.example` file shows the required variables without real values
- Rotate your refresh token periodically
- If exposing via Tailscale Funnel, ensure your Funnel ACLs are properly configured

## License

MIT (same as upstream)
