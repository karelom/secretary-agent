# Secretary Agent

Secretary Agent is a local-first personal assistant interface built around Pi.
It owns the user conversation and coordinates agent behavior. Task Manager
integration is intentionally left for the next phase.

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
- Pi's working directory can be set with `PI_WORKING_DIRECTORY`.

Task Manager data is not accessed by this project yet. The Task Manager API and
agent decision flow will be added in the next integration phase.
