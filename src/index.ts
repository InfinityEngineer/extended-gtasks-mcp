#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import fs from "fs";
import { google } from "googleapis";
import path from "path";
import { OAuth2Client } from "google-auth-library";
import { TaskActions, TaskResources } from "./Tasks.js";

// OAuth2 credentials from environment variables
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const REDIRECT_URI = "http://localhost";
const REQUIRED_SCOPES = ["https://www.googleapis.com/auth/tasks"];

// Define paths for credentials
const credentialsPath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../.gtasks-server-credentials.json"
);

// Also check for a local config file in the user's home directory
const homeDir = process.env.HOME || process.env.USERPROFILE || "";
const localConfigPath = path.join(homeDir, ".gtasks-credentials.json");

// Debug environment variables
console.error("=== ENVIRONMENT VARIABLES DEBUG ===");
console.error(
  `CLIENT_ID present: ${Boolean(CLIENT_ID)} (${CLIENT_ID ? CLIENT_ID.substring(0, 8) + "..." : "not set"})`
);
console.error(
  `CLIENT_SECRET present: ${Boolean(CLIENT_SECRET)} (${CLIENT_SECRET ? CLIENT_SECRET.substring(0, 5) + "..." : "not set"})`
);
console.error(
  `REFRESH_TOKEN present: ${Boolean(REFRESH_TOKEN)} (${REFRESH_TOKEN ? REFRESH_TOKEN.substring(0, 8) + "..." : "not set"})`
);
console.error(`Home directory: ${homeDir}`);
console.error(`Looking for local config at: ${localConfigPath}`);
console.error(
  `Local config exists: ${fs.existsSync(localConfigPath)}`
);
console.error("=== END DEBUG INFO ===");

// Initialize auth client and Google Tasks API
let oauth2Client: OAuth2Client | null = null;
let tasks: ReturnType<typeof google.tasks> | null = null;
let isAuthenticated = false;

// Function to authenticate and initialize the Google Tasks API
async function initializeAuth(): Promise<boolean> {
  if (isAuthenticated) return true;

  try {
    // Check different sources for credentials in order of preference:
    // 1. Environment variables
    // 2. Local config file in user's home directory
    // 3. Credentials file in the package directory
    if (CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN) {
      // 1. Use environment variables if available
      console.error("Using credentials from environment variables");
      oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
      oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    } else if (fs.existsSync(localConfigPath)) {
      // 2. Try local config file in user's home directory
      console.error("Using credentials from local config file");
      try {
        const localConfig = JSON.parse(
          fs.readFileSync(localConfigPath, "utf-8")
        );
        oauth2Client = new OAuth2Client(
          localConfig.clientId,
          localConfig.clientSecret,
          REDIRECT_URI
        );
        oauth2Client.setCredentials({
          refresh_token: localConfig.refreshToken,
        });
      } catch (error) {
        console.error("Error reading local config:", error);
        return false;
      }
    } else if (fs.existsSync(credentialsPath)) {
      // 3. Fall back to credentials file in the package directory
      console.error("Using credentials from package credentials file");
      const credentials = JSON.parse(
        fs.readFileSync(credentialsPath, "utf-8")
      );
      oauth2Client = new OAuth2Client();
      oauth2Client.setCredentials(credentials);
    } else {
      // No credentials found
      console.error(
        "Credentials not found. Please either:\n" +
          "1. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN environment variables\n" +
          "2. Create a .gtasks-credentials.json file in your home directory with your credentials\n" +
          "3. Run with 'auth' argument first to create credentials file in the package directory"
      );
      return false;
    }

    // Fix 5: Force initial token exchange to avoid "first call always fails"
    console.error("Forcing initial token exchange...");
    await oauth2Client.getAccessToken();
    console.error("Token exchange successful");

    // Initialize Google Tasks API
    tasks = google.tasks({ version: "v1", auth: oauth2Client });
    isAuthenticated = true;
    return true;
  } catch (error) {
    console.error("Authentication error:", error);
    return false;
  }
}

/**
 * Creates and configures a new MCP Server instance with all handlers.
 * A fresh server is created per SSE session since SDK 1.0.1's Server
 * can only be connected to one transport at a time.
 */
function createServer(): Server {
  const server = new Server(
    {
      name: "extended-gtasks-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  // Handle listing resources (tasks)
  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    if (!(await initializeAuth())) {
      return {
        resources: [],
        error:
          "Authentication required. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.",
      };
    }

    const [allTasks, nextPageToken] = await TaskResources.list(
      request,
      tasks!
    );
    return {
      resources: allTasks.map((task: any) => ({
        uri: `gtasks:///${task.id}`,
        mimeType: "text/plain",
        name: task.title,
      })),
      nextCursor: nextPageToken ?? undefined,
    };
  });

  // Handle reading a specific task
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (!(await initializeAuth())) {
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "text/plain",
            text: "Authentication required. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.",
          },
        ],
      };
    }

    const task = await TaskResources.read(request, tasks!);
    const taskDetails = [
      `Title: ${task.title || "No title"}`,
      `Status: ${task.status || "Unknown"}`,
      `Due: ${task.due || "Not set"}`,
      `Notes: ${task.notes || "No notes"}`,
      `Hidden: ${task.hidden || "Unknown"}`,
      `Parent: ${task.parent || "Unknown"}`,
      `Deleted?: ${task.deleted || "Unknown"}`,
      `Completed Date: ${task.completed || "Unknown"}`,
      `Position: ${task.position || "Unknown"}`,
      `ETag: ${task.etag || "Unknown"}`,
      `Links: ${task.links || "Unknown"}`,
      `Kind: ${task.kind || "Unknown"}`,
      `Status: ${task.status || "Unknown"}`,
      `Created: ${task.updated || "Unknown"}`,
      `Updated: ${task.updated || "Unknown"}`,
    ].join("\n");

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/plain",
          text: taskDetails,
        },
      ],
    };
  });

  // Handle listing available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "search",
          description: "Search for a task in Google Tasks",
          inputSchema: {
            type: "object" as const,
            properties: {
              query: {
                type: "string",
                description: "Search query",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "list",
          description: "List all tasks in Google Tasks",
          inputSchema: {
            type: "object" as const,
            properties: {
              taskListId: {
                type: "string",
                description:
                  "Task list ID or name. If omitted, lists tasks from all lists.",
              },
              cursor: {
                type: "string",
                description: "Cursor for pagination",
              },
              showCompleted: {
                type: "boolean",
                description:
                  "Whether to include completed tasks. Default true.",
              },
              showHidden: {
                type: "boolean",
                description:
                  "Whether to show tasks hidden by 'clear completed'. Default false.",
              },
              dueMin: {
                type: "string",
                description:
                  "Lower bound for task due date (RFC 3339, e.g. 2026-02-07T00:00:00.000Z). Only returns tasks due on or after this date.",
              },
              dueMax: {
                type: "string",
                description:
                  "Upper bound for task due date (RFC 3339, e.g. 2026-02-14T00:00:00.000Z). Only returns tasks due before this date.",
              },
              updatedMin: {
                type: "string",
                description:
                  "Lower bound for last modification time (RFC 3339). Only returns tasks updated after this timestamp.",
              },
            },
          },
        },
        {
          name: "create",
          description: "Create a new task in Google Tasks",
          inputSchema: {
            type: "object" as const,
            properties: {
              taskListId: {
                type: "string",
                description: "Task list ID or name",
              },
              title: {
                type: "string",
                description: "Task title",
              },
              notes: {
                type: "string",
                description: "Task notes",
              },
              due: {
                type: "string",
                description: "Due date",
              },
            },
            required: ["title"],
          },
        },
        {
          name: "clear",
          description:
            "Clear completed tasks from a Google Tasks task list",
          inputSchema: {
            type: "object" as const,
            properties: {
              taskListId: {
                type: "string",
                description: "Task list ID or name",
              },
            },
            required: ["taskListId"],
          },
        },
        {
          name: "delete",
          description: "Delete a task in Google Tasks",
          inputSchema: {
            type: "object" as const,
            properties: {
              taskListId: {
                type: "string",
                description: "Task list ID or name",
              },
              id: {
                type: "string",
                description: "Task id",
              },
            },
            required: ["id", "taskListId"],
          },
        },
        {
          name: "update",
          description: "Update a task in Google Tasks (uses PATCH — only modifies fields you provide)",
          inputSchema: {
            type: "object" as const,
            properties: {
              taskListId: {
                type: "string",
                description: "Task list ID or name",
              },
              id: {
                type: "string",
                description: "Task ID",
              },
              title: {
                type: "string",
                description: "Task title",
              },
              notes: {
                type: "string",
                description: "Task notes",
              },
              status: {
                type: "string",
                enum: ["needsAction", "completed"],
                description:
                  "Task status (needsAction or completed)",
              },
              due: {
                type: "string",
                description: "Due date",
              },
            },
            required: ["id"],
          },
        },
        // Fix 2: list_task_lists
        {
          name: "list_task_lists",
          description:
            "List all task lists in Google Tasks with their IDs and names",
          inputSchema: {
            type: "object" as const,
            properties: {},
          },
        },
        // Fix 3: create_task_list
        {
          name: "create_task_list",
          description: "Create a new task list in Google Tasks",
          inputSchema: {
            type: "object" as const,
            properties: {
              title: {
                type: "string",
                description: "Name for the new task list",
              },
            },
            required: ["title"],
          },
        },
        // Fix 9: filter_by_tag
        {
          name: "filter_by_tag",
          description:
            "Filter tasks by bracket-tag convention (e.g. [Life], [House], [Tech]) found in task notes/description. Returns all tasks matching the given tag.",
          inputSchema: {
            type: "object" as const,
            properties: {
              tag: {
                type: "string",
                description:
                  "The tag to filter by, without brackets (e.g. 'Life', 'House', 'Tech'). Case-insensitive.",
              },
              taskListId: {
                type: "string",
                description:
                  "The task list to search. Supports list ID or name.",
              },
              includeCompleted: {
                type: "boolean",
                description:
                  "Whether to include completed tasks. Default false.",
              },
            },
            required: ["tag"],
          },
        },
      ],
    };
  });

  // Handle tool call requests
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      // Authenticate first
      if (!(await initializeAuth())) {
        return {
          content: [
            {
              type: "text",
              text: "Authentication required. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.",
            },
          ],
          isError: true,
        };
      }

      const toolName = request.params.name;

      if (toolName === "search") {
        return await TaskActions.search(request, tasks!);
      }
      if (toolName === "list") {
        return await TaskActions.list(request, tasks!);
      }
      if (toolName === "create") {
        return await TaskActions.create(request, tasks!);
      }
      if (toolName === "update") {
        return await TaskActions.update(request, tasks!);
      }
      if (toolName === "delete") {
        return await TaskActions.delete(request, tasks!);
      }
      if (toolName === "clear") {
        return await TaskActions.clear(request, tasks!);
      }
      if (toolName === "list_task_lists") {
        return await TaskActions.listTaskLists(tasks!);
      }
      if (toolName === "create_task_list") {
        const title = request.params.arguments?.title as string;
        if (!title) {
          return {
            content: [{ type: "text", text: "Error: title is required" }],
            isError: true,
          };
        }
        return await TaskActions.createTaskList(title, tasks!);
      }
      if (toolName === "filter_by_tag") {
        const args = request.params.arguments || {};
        const tag = args.tag as string;
        if (!tag) {
          return {
            content: [{ type: "text", text: "Error: tag is required" }],
            isError: true,
          };
        }
        return await TaskActions.filterByTag(
          tag,
          tasks!,
          args.taskListId as string | undefined,
          (args.includeCompleted as boolean) ?? false
        );
      }

      throw new Error(`Tool not found: ${toolName}`);
    } catch (error: any) {
      // Fix 5: Reset auth on 401 so re-auth is attempted on next call
      if (error?.response?.status === 401 || error?.code === 401) {
        console.error("Got 401, resetting authentication state for re-auth");
        isAuthenticated = false;
      }

      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// Function to authenticate using the OAuth2 flow and save credentials
async function authenticateAndSaveCredentials() {
  console.log("Launching auth flow…");
  const p = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "../gcp-oauth.keys.json"
  );
  console.log(p);
  const { authenticate } = await import("@google-cloud/local-auth");
  const auth = await authenticate({
    keyfilePath: p,
    scopes: REQUIRED_SCOPES,
  });
  fs.writeFileSync(credentialsPath, JSON.stringify(auth.credentials));
  console.log("Credentials saved. You can now run the server.");
}

// Fix 7: Native SSE transport (no supergateway needed)
async function initializeAndRunServer() {
  // Check if we're in auth mode
  if (process.argv[2] === "auth") {
    await authenticateAndSaveCredentials().catch(console.error);
    return;
  }

  const app = express();
  const PORT = parseInt(process.env.PORT || "3000");

  // Store active transports
  const transports: Record<string, SSEServerTransport> = {};

  app.get("/sse", async (req, res) => {
    console.error(`New SSE connection from ${req.ip}`);
    const transport = new SSEServerTransport("/message", res);
    transports[transport.sessionId] = transport;

    res.on("close", () => {
      console.error(`SSE connection closed: ${transport.sessionId}`);
      delete transports[transport.sessionId];
    });

    // Each SSE connection gets its own server instance
    // because SDK 1.0.1's Server can only bind one transport at a time
    const server = createServer();
    await server.connect(transport);
  });

  app.post("/message", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports[sessionId];
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(404).send("Session not found");
    }
  });

  // Pre-warm auth on startup
  console.error("Pre-warming authentication...");
  await initializeAuth().catch((err) => {
    console.error("Auth pre-warm failed (will retry on first request):", err);
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.error(`Google Tasks MCP Server listening on port ${PORT}`);
    console.error(`SSE endpoint: http://0.0.0.0:${PORT}/sse`);
  });
}

// Run the server
initializeAndRunServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
