# Secretary Agent

Secretary Agent is a local-first personal assistant interface built around Pi.
It owns the user conversation and coordinates agent behavior, with an optional
server-side connection to the separate Task Manager project.

## Requirements

- Node.js 20 or newer
- Pi CLI available in the server environment
- LM Studio running locally with the model configured for Pi

## Run locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The server binds to loopback
so the Pi process is not exposed to the local network. Set `PI_BIN` if Pi is not
available on `PATH`. `PI_PROVIDER` and `PI_MODEL` are optional overrides.

## Current behavior

- Chat messages stream through Pi's RPC mode.
- Pi runs in a fresh, non-persisted session for each user turn.
- Conversation history is saved in this browser and replayed as context.
- Tool activity is shown in the conversation.
- Pi receives only Task Manager tools for this assistant.

## Task Manager connection

Run the Task Manager app locally and configure the same random bearer token in
both apps. For example, generate one with `openssl rand -hex 32`, then set
`TASK_MANAGER_API_TOKEN` in Task Manager's local environment and in this app's
`.env.local`. Keep the token server-side. Secretary Agent uses the Task Manager
API to list projects and tasks, create tasks, update them, and mark them done.

Secretary Agent asks before saving a suggested plan. It only reports a task
change after the Task Manager API confirms success.
