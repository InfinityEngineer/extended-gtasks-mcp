import { tasks_v1 } from "googleapis";
import { withRetry } from "./utils.js";

const MAX_TASK_RESULTS = 100;

type TasksAPI = tasks_v1.Tasks;

/**
 * Resolve a taskListId that could be an ID or a name.
 * Returns the resolved list ID and the full array of task lists.
 */
async function resolveTaskListId(
  tasks: TasksAPI,
  requestedTaskListId?: string
): Promise<{ taskListId: string; taskLists: tasks_v1.Schema$TaskList[] }> {
  const taskListsResponse = await withRetry(() =>
    tasks.tasklists.list({ maxResults: MAX_TASK_RESULTS })
  );
  const taskLists = taskListsResponse.data.items || [];

  if (!taskLists.length) {
    throw new Error("No task lists found in your Google Tasks account");
  }

  if (!requestedTaskListId || requestedTaskListId === "@default") {
    console.error(
      `Using first task list: ${taskLists[0].title} (${taskLists[0].id})`
    );
    return { taskListId: taskLists[0].id!, taskLists };
  }

  // Try exact ID match first
  let foundTaskList = taskLists.find(
    (list) => list.id === requestedTaskListId
  );

  // Fall back to case-insensitive name match
  if (!foundTaskList) {
    foundTaskList = taskLists.find(
      (list) =>
        list.title?.toLowerCase() === requestedTaskListId.toLowerCase()
    );
  }

  if (foundTaskList) {
    console.error(
      `Resolved task list: ${foundTaskList.title} (${foundTaskList.id})`
    );
    return { taskListId: foundTaskList.id!, taskLists };
  }

  // Fall back to first list
  console.error(
    `Requested task list "${requestedTaskListId}" not found, using first task list: ${taskLists[0].title} (${taskLists[0].id})`
  );
  return { taskListId: taskLists[0].id!, taskLists };
}

function formatTask(task: tasks_v1.Schema$Task): string {
  return `${task.title}\n (Due: ${task.due || "Not set"}) - Notes: ${task.notes || ""} - ID: ${task.id} - Status: ${task.status} - URI: ${task.selfLink} - Hidden: ${task.hidden} - Parent: ${task.parent} - Deleted?: ${task.deleted} - Completed Date: ${task.completed} - Position: ${task.position} - Updated Date: ${task.updated} - ETag: ${task.etag} - Links: ${task.links} - Kind: ${task.kind}}`;
}

function formatTaskList(taskList: tasks_v1.Schema$Task[]): string {
  return taskList.map((task) => formatTask(task)).join("\n");
}

export class TaskResources {
  static async read(request: any, tasks: TasksAPI) {
    const taskId = request.params.uri.replace("gtasks:///", "");
    const taskListsResponse = await withRetry(() =>
      tasks.tasklists.list({ maxResults: MAX_TASK_RESULTS })
    );
    const taskLists = taskListsResponse.data.items || [];

    let task = null;
    for (const taskList of taskLists) {
      if (taskList.id) {
        try {
          const taskResponse = await withRetry(() =>
            tasks.tasks.get({
              tasklist: taskList.id!,
              task: taskId,
            })
          );
          task = taskResponse.data;
          break;
        } catch (error) {
          // Task not found in this list, continue to the next one
        }
      }
    }

    if (!task) {
      throw new Error("Task not found");
    }
    return task;
  }

  static async list(request: any, tasks: TasksAPI) {
    const pageSize = 10;
    const params: any = {
      maxResults: pageSize,
    };
    if (request.params?.cursor) {
      params.pageToken = request.params.cursor;
    }

    const taskListsResponse = await withRetry(() =>
      tasks.tasklists.list({ maxResults: MAX_TASK_RESULTS })
    );
    const taskLists = taskListsResponse.data.items || [];

    let allTasks: tasks_v1.Schema$Task[] = [];
    let nextPageToken: string | null = null;

    for (const taskList of taskLists) {
      const tasksResponse = await withRetry(() =>
        tasks.tasks.list({
          tasklist: taskList.id!,
          ...params,
        })
      );
      const taskItems = tasksResponse.data.items || [];
      allTasks = allTasks.concat(taskItems);
      if (tasksResponse.data.nextPageToken) {
        nextPageToken = tasksResponse.data.nextPageToken;
      }
    }

    return [allTasks, nextPageToken] as const;
  }
}

export class TaskActions {
  /**
   * Internal list method used by search and the public list action.
   * Accepts optional filter params (Fix 8).
   */
  static async _list(
    tasks: TasksAPI,
    opts: {
      taskListId?: string;
      showCompleted?: boolean;
      showHidden?: boolean;
      dueMin?: string;
      dueMax?: string;
      updatedMin?: string;
      pageToken?: string;
    } = {}
  ): Promise<tasks_v1.Schema$Task[]> {
    let taskListIds: string[];

    if (opts.taskListId) {
      const resolved = await resolveTaskListId(tasks, opts.taskListId);
      taskListIds = [resolved.taskListId];
    } else {
      const taskListsResponse = await withRetry(() =>
        tasks.tasklists.list({ maxResults: MAX_TASK_RESULTS })
      );
      taskListIds = (taskListsResponse.data.items || [])
        .map((l) => l.id!)
        .filter(Boolean);
    }

    let allTasks: tasks_v1.Schema$Task[] = [];

    for (const listId of taskListIds) {
      try {
        const listParams: any = {
          tasklist: listId,
          maxResults: MAX_TASK_RESULTS,
          showCompleted: opts.showCompleted ?? true,
          showHidden: opts.showHidden ?? false,
        };
        if (opts.dueMin) listParams.dueMin = opts.dueMin;
        if (opts.dueMax) listParams.dueMax = opts.dueMax;
        if (opts.updatedMin) listParams.updatedMin = opts.updatedMin;
        if (opts.pageToken) listParams.pageToken = opts.pageToken;

        const tasksResponse = await withRetry(() =>
          tasks.tasks.list(listParams)
        );
        const items = tasksResponse.data.items || [];
        allTasks = allTasks.concat(items);
      } catch (error) {
        console.error(`Error fetching tasks for list ${listId}:`, error);
      }
    }

    return allTasks;
  }

  static async create(request: any, tasks: TasksAPI) {
    try {
      const args = request.params.arguments || {};
      let taskListId: string;

      // If no task lists exist, create a default one
      try {
        const resolved = await resolveTaskListId(tasks, args.taskListId);
        taskListId = resolved.taskListId;
      } catch (error: any) {
        if (error.message?.includes("No task lists found")) {
          console.error("No task lists found, creating a default task list");
          const newTaskList = await withRetry(() =>
            tasks.tasklists.insert({
              requestBody: { title: "My Tasks" },
            })
          );
          if (!newTaskList.data.id) {
            throw new Error("Failed to create a new task list");
          }
          taskListId = newTaskList.data.id;
          console.error(
            `Created new task list: ${newTaskList.data.title} (${taskListId})`
          );
        } else {
          throw error;
        }
      }

      const taskTitle = args.title;
      const taskNotes = args.notes;
      const taskStatus = args.status;
      const taskDue = args.due;

      if (!taskTitle) {
        throw new Error("Task title is required");
      }

      const task: Record<string, any> = {
        title: taskTitle,
        status: taskStatus || "needsAction",
      };
      if (taskNotes !== undefined) task.notes = taskNotes;
      if (taskDue !== undefined) task.due = taskDue;

      console.error(`Creating task "${taskTitle}" in task list ${taskListId}`);
      const taskResponse = await withRetry(() =>
        tasks.tasks.insert({
          tasklist: taskListId,
          requestBody: task,
        })
      );

      return {
        content: [
          {
            type: "text",
            text: `Task created: ${taskResponse.data.title} (ID: ${taskResponse.data.id})`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error creating task:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error creating task: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Fix 1: Uses PATCH instead of PUT to avoid clearing fields not included in the request.
   * Fix 4: Supports task list name lookup.
   */
  static async update(request: any, tasks: TasksAPI) {
    try {
      const args = request.params.arguments || {};
      const { taskListId: resolvedListId } = await resolveTaskListId(
        tasks,
        args.taskListId
      );

      const taskId = args.id;
      if (!taskId) {
        throw new Error("Task ID is required");
      }

      // Strip undefined/null values so PATCH doesn't accidentally null out fields
      const task: Record<string, any> = {};
      if (taskId) task.id = taskId;
      if (args.title !== undefined) task.title = args.title;
      if (args.notes !== undefined) task.notes = args.notes;
      if (args.status !== undefined) task.status = args.status;
      if (args.due !== undefined) task.due = args.due;

      console.error(
        `Patching task ${taskId} in list ${resolvedListId} with fields: ${Object.keys(task).join(", ")}`
      );

      const taskResponse = await withRetry(() =>
        tasks.tasks.patch({
          tasklist: resolvedListId,
          task: taskId,
          requestBody: task,
        })
      );

      return {
        content: [
          {
            type: "text",
            text: `Task updated: ${taskResponse.data.title} (status: ${taskResponse.data.status})`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error updating task:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error updating task: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Fix 8: Supports API-level filters (showCompleted, showHidden, dueMin, dueMax, updatedMin).
   */
  static async list(request: any, tasks: TasksAPI) {
    try {
      const args = request.params.arguments || {};
      const allTasks = await this._list(tasks, {
        taskListId: args.taskListId,
        showCompleted: args.showCompleted,
        showHidden: args.showHidden,
        dueMin: args.dueMin,
        dueMax: args.dueMax,
        updatedMin: args.updatedMin,
        pageToken: args.cursor,
      });

      const taskList = formatTaskList(allTasks);
      return {
        content: [
          {
            type: "text",
            text: `Found ${allTasks.length} tasks:\n${taskList}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error listing tasks:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error listing tasks: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  static async delete(request: any, tasks: TasksAPI) {
    try {
      const args = request.params.arguments || {};
      const { taskListId } = await resolveTaskListId(tasks, args.taskListId);

      const taskId = args.id;
      if (!taskId) {
        throw new Error("Task ID is required");
      }

      await withRetry(() =>
        tasks.tasks.delete({
          tasklist: taskListId,
          task: taskId,
        })
      );

      return {
        content: [
          {
            type: "text",
            text: `Task ${taskId} deleted`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error deleting task:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error deleting task: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  static async search(request: any, tasks: TasksAPI) {
    try {
      const userQuery = request.params.arguments?.query;
      if (!userQuery) {
        throw new Error("Search query is required");
      }
      const allTasks = await this._list(tasks);
      const filteredItems = allTasks.filter(
        (task) =>
          task.title?.toLowerCase().includes(userQuery.toLowerCase()) ||
          task.notes?.toLowerCase().includes(userQuery.toLowerCase())
      );

      const taskList = formatTaskList(filteredItems);
      return {
        content: [
          {
            type: "text",
            text: `Found ${filteredItems.length} tasks matching "${userQuery}":\n${taskList}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error searching tasks:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error searching tasks: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  static async clear(request: any, tasks: TasksAPI) {
    try {
      const args = request.params.arguments || {};
      const { taskListId } = await resolveTaskListId(tasks, args.taskListId);

      await withRetry(() =>
        tasks.tasks.clear({
          tasklist: taskListId,
        })
      );

      return {
        content: [
          {
            type: "text",
            text: `Cleared all completed tasks from list`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error clearing tasks:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error clearing tasks: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Fix 2: List all task lists with their IDs and names.
   */
  static async listTaskLists(tasks: TasksAPI) {
    try {
      const taskListsResponse = await withRetry(() =>
        tasks.tasklists.list({ maxResults: MAX_TASK_RESULTS })
      );
      const taskLists = taskListsResponse.data.items || [];

      const result = taskLists.map((list) => ({
        id: list.id,
        title: list.title,
        updated: list.updated,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { count: result.length, taskLists: result },
              null,
              2
            ),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error listing task lists:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error listing task lists: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Fix 3: Create a new task list.
   */
  static async createTaskList(title: string, tasks: TasksAPI) {
    try {
      const response = await withRetry(() =>
        tasks.tasklists.insert({
          requestBody: { title },
        })
      );

      return {
        content: [
          {
            type: "text",
            text: `Task list created: ${response.data.title} (ID: ${response.data.id})`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error creating task list:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error creating task list: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Fix 9: Filter tasks by bracket-tag convention in notes/title.
   */
  static async filterByTag(
    tag: string,
    tasks: TasksAPI,
    taskListId?: string,
    includeCompleted = false
  ) {
    try {
      const allTasks = await this._list(tasks, {
        taskListId,
        showCompleted: includeCompleted,
      });

      const tagPattern = new RegExp(`\\[${tag}\\]`, "i");
      const matched = allTasks.filter(
        (task) =>
          tagPattern.test(task.notes || "") ||
          tagPattern.test(task.title || "")
      );

      if (matched.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: `No tasks found with tag [${tag}]`,
                count: 0,
              }),
            },
          ],
          isError: false,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                tag: `[${tag}]`,
                count: matched.length,
                tasks: matched.map((t) => ({
                  id: t.id,
                  title: t.title,
                  status: t.status,
                  due: t.due,
                  notes: t.notes,
                })),
              },
              null,
              2
            ),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error filtering by tag:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error filtering by tag: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Add a bracket-tag to a task's notes without clobbering existing content.
   */
  static async addTag(
    taskId: string,
    tag: string,
    tasks: TasksAPI,
    taskListId?: string
  ) {
    try {
      const { taskListId: resolvedListId } = await resolveTaskListId(
        tasks,
        taskListId
      );

      // Fetch the current task to get existing notes
      const existing = await withRetry(() =>
        tasks.tasks.get({ tasklist: resolvedListId, task: taskId })
      );
      const currentNotes = existing.data.notes || "";
      const tagStr = `[${tag}]`;

      // Check if tag already exists (case-insensitive)
      const tagPattern = new RegExp(`\\[${tag}\\]`, "i");
      if (tagPattern.test(currentNotes)) {
        return {
          content: [
            {
              type: "text",
              text: `Tag ${tagStr} already exists on task "${existing.data.title}"`,
            },
          ],
          isError: false,
        };
      }

      // Append tag to notes
      const newNotes = currentNotes ? `${currentNotes}\n${tagStr}` : tagStr;

      await withRetry(() =>
        tasks.tasks.patch({
          tasklist: resolvedListId,
          task: taskId,
          requestBody: { id: taskId, notes: newNotes },
        })
      );

      return {
        content: [
          {
            type: "text",
            text: `Tag ${tagStr} added to task "${existing.data.title}"`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error adding tag:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error adding tag: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Remove a bracket-tag from a task's notes.
   */
  static async removeTag(
    taskId: string,
    tag: string,
    tasks: TasksAPI,
    taskListId?: string
  ) {
    try {
      const { taskListId: resolvedListId } = await resolveTaskListId(
        tasks,
        taskListId
      );

      // Fetch the current task to get existing notes
      const existing = await withRetry(() =>
        tasks.tasks.get({ tasklist: resolvedListId, task: taskId })
      );
      const currentNotes = existing.data.notes || "";
      const tagPattern = new RegExp(`\\s*\\[${tag}\\]\\s*`, "gi");

      if (!tagPattern.test(currentNotes)) {
        return {
          content: [
            {
              type: "text",
              text: `Tag [${tag}] not found on task "${existing.data.title}"`,
            },
          ],
          isError: false,
        };
      }

      const newNotes = currentNotes.replace(tagPattern, "\n").replace(/^\n+|\n+$/g, "");

      await withRetry(() =>
        tasks.tasks.patch({
          tasklist: resolvedListId,
          task: taskId,
          requestBody: { id: taskId, notes: newNotes },
        })
      );

      return {
        content: [
          {
            type: "text",
            text: `Tag [${tag}] removed from task "${existing.data.title}"`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error removing tag:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error removing tag: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Find tasks due within a date range. Accepts days-from-now or explicit RFC 3339 dates.
   */
  static async dueSoon(
    tasks: TasksAPI,
    opts: {
      days?: number;
      dueMin?: string;
      dueMax?: string;
      taskListId?: string;
      showCompleted?: boolean;
    } = {}
  ) {
    try {
      const now = new Date();
      let dueMin = opts.dueMin;
      let dueMax = opts.dueMax;

      if (opts.days !== undefined && !dueMax) {
        if (!dueMin) {
          dueMin = now.toISOString();
        }
        const end = new Date(now);
        end.setDate(end.getDate() + opts.days);
        end.setHours(23, 59, 59, 999);
        dueMax = end.toISOString();
      }

      const allTasks = await this._list(tasks, {
        taskListId: opts.taskListId,
        showCompleted: opts.showCompleted ?? false,
        dueMin,
        dueMax,
      });

      const summary = allTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        due: t.due || null,
        notes: t.notes || null,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                range: { dueMin, dueMax },
                count: summary.length,
                tasks: summary,
              },
              null,
              2
            ),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error finding due-soon tasks:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error finding due-soon tasks: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Token-efficient task listing: returns only title, status, due, and id.
   */
  static async listSummary(
    tasks: TasksAPI,
    opts: {
      taskListId?: string;
      showCompleted?: boolean;
    } = {}
  ) {
    try {
      const allTasks = await this._list(tasks, {
        taskListId: opts.taskListId,
        showCompleted: opts.showCompleted ?? true,
      });

      const summary = allTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        due: t.due || null,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: summary.length, tasks: summary }, null, 2),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error("Error listing task summary:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error listing task summary: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
}
