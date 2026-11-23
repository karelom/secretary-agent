const taskStatuses = ['backlog', 'pending', 'in-progress', 'completed'];
const taskPriorities = ['none', 'low', 'medium', 'high'];

function textResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    details: {},
    ...(isError ? { isError: true } : {}),
  };
}

async function taskManagerRequest(path, options = {}) {
  const baseUrl = process.env.TASK_MANAGER_API_URL;
  const token = process.env.TASK_MANAGER_API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error('TASK_MANAGER_API_URL and TASK_MANAGER_API_TOKEN must be configured.');
  }

  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) ?? {};
  if (!response.ok) throw new Error(payload.error ?? `Task Manager returned ${response.status}.`);
  return payload.data;
}

function registerTaskTool(pi, { name, label, description, promptSnippet, promptGuidelines, parameters, run }) {
  pi.registerTool({
    name,
    label,
    description,
    promptSnippet,
    promptGuidelines,
    parameters,
    async execute(_id, params) {
      try {
        return textResult(await run(params));
      } catch (error) {
        return textResult(error instanceof Error ? error.message : 'Task operation failed.', true);
      }
    },
  });
}

export default function registerTaskManagerTools(pi) {
  registerTaskTool(pi, {
    name: 'list_tasks',
    label: 'List tasks',
    description: 'Read active tasks from the connected Task Manager.',
    promptSnippet: 'Read tasks from the connected Task Manager.',
    promptGuidelines: ['Use list_tasks before creating a task that may already exist.'],
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Optional project UUID.' },
        status: { type: 'string', enum: taskStatuses },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    async run(params) {
      const query = new URLSearchParams({ kind: 'tasks' });
      if (params.project_id) query.set('projectId', params.project_id);
      if (params.status) query.set('status', params.status);
      if (params.limit) query.set('limit', String(params.limit));
      return taskManagerRequest(`?${query}`);
    },
  });

  registerTaskTool(pi, {
    name: 'list_projects',
    label: 'List projects',
    description: 'Read active projects so tasks can be assigned to the right project.',
    promptSnippet: 'Read projects from the connected Task Manager.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      return taskManagerRequest('?kind=projects');
    },
  });

  registerTaskTool(pi, {
    name: 'create_task',
    label: 'Create task',
    description: 'Create a task after the user explicitly asks to save or track it.',
    promptSnippet: 'Create a task only when the user asks to save or track it.',
    promptGuidelines: [
      'Use create_task only for an explicit request to save or track a task. Ask before saving a proposed plan.',
      'If the project is unclear, ask which project to use before creating the task.',
    ],
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 255 },
        description: { type: 'string' },
        project_id: { type: 'string', description: 'Optional project UUID.' },
        priority: { type: 'string', enum: taskPriorities },
        due_at: { type: ['string', 'null'], format: 'date-time' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    async run(params) {
      return taskManagerRequest('', {
        method: 'POST',
        body: JSON.stringify({
          title: params.title,
          description: params.description ?? '',
          projectId: params.project_id ?? null,
          priority: params.priority ?? 'none',
          dueAt: params.due_at ?? null,
        }),
      });
    },
  });

  registerTaskTool(pi, {
    name: 'update_task',
    label: 'Update task',
    description: 'Update selected fields on an active task after the user asks.',
    promptSnippet: 'Update a task only when the user explicitly asks to change it.',
    promptGuidelines: [
      'Use update_task only after the user asks to change an existing task; identify it with list_tasks first.',
    ],
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        title: { type: 'string', minLength: 1, maxLength: 255 },
        description: { type: 'string' },
        status: { type: 'string', enum: taskStatuses },
        priority: { type: 'string', enum: taskPriorities },
        due_at: { type: ['string', 'null'], format: 'date-time' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
    async run(params) {
      const updates = {};
      if (params.title !== undefined) updates.title = params.title;
      if (params.description !== undefined) updates.description = params.description;
      if (params.status !== undefined) updates.status = params.status;
      if (params.priority !== undefined) updates.priority = params.priority;
      if (params.due_at !== undefined) updates.dueAt = params.due_at;
      return taskManagerRequest('', {
        method: 'PATCH',
        body: JSON.stringify({ taskId: params.task_id, updates }),
      });
    },
  });

  registerTaskTool(pi, {
    name: 'complete_task',
    label: 'Complete task',
    description: 'Mark a task complete when the user says it is done.',
    promptSnippet: 'Mark a task complete only when the user says it is done.',
    promptGuidelines: [
      'Use complete_task only when the user explicitly says the task is done; find the task with list_tasks first.',
    ],
    parameters: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
      additionalProperties: false,
    },
    async run(params) {
      return taskManagerRequest('', {
        method: 'PATCH',
        body: JSON.stringify({ taskId: params.task_id, complete: true }),
      });
    },
  });
}
