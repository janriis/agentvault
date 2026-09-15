# Agent Vault

An EVE-based, filesystem-first vault for spawning focused agents by purpose.
The root agent coordinates work, while specialists under `agent/subagents/`
handle research, planning, writing, analysis, and review.

## Run it

Requirements: Node.js 24+ and a ChatGPT subscription that can access the
selected model. This vault is configured to use your local ChatGPT login; it
does not require an AI Gateway API key.

```bash
npm run typecheck
npm run dev
```

Open the web app at [http://localhost:3000](http://localhost:3000). The development
command starts both the web server and a local task worker. To choose another
port, pass it explicitly, for example `npm run dev -- -p 3001`; the worker will
use the same port. For EVE's interactive terminal instead, run `npm run dev:eve`.
For a separately hosted web server, run `npm run worker -- --host http://127.0.0.1:3001`
in its own terminal. The worker and web server must use the same
`AGENT_VAULT_DATA_DIR`; keep the worker process running to execute tasks when
no browser is open.

The home screen is the Agent Vault workspace. It includes the Agent Library,
Agent Spawner, Workshop Rooms, Room Roles, Task Board, Shared Artifacts, and
Activity Timeline. The existing live EVE conversation remains available at
`/s` via **Open live chat**.

The default model is **ChatGPT subscription**, which uses your local ChatGPT
login and does not require an API key. If EVE asks you to authenticate, open
`/model` and choose **Provider → ChatGPT subscription**.

Open **Settings** in the workspace navigation to configure the vault name,
default provider, Ollama address, task attempt and timeout policies, automatic
backup interval, and confirmation policy. These settings are stored in the
durable SQLite backend rather than browser state. Maximum task attempts, task
timeouts, and automatic backup scheduling are active; confirmation settings
are recorded for the centralized safety engine.

## Use local Ollama models

Install and start [Ollama](https://ollama.com), then download at least one
model, for example:

```bash
ollama pull qwen3:8b
```

Refresh the web app. The model picker scans the local Ollama endpoint at
`http://127.0.0.1:11434`, lists the models returned by Ollama, and remembers
your choice in this browser. Delegated specialists use the selected model as
well. If Ollama is not running, the picker reports **Ollama offline**
and ChatGPT remains available.

To use a different local Ollama host, set `OLLAMA_HOST` before starting the web
app. Only loopback hosts are accepted by the discovery route.

Try prompts such as:

- `What agents are available in this vault?`
- `Research three options for ... and compare them.`
- `Plan ... and have the reviewer stress-test the plan.`
- `Draft ... and ask the reviewer to check the result.`

## Add a new specialist

Create a directory under `agent/subagents/<id>/` with an `agent.ts` containing a
description and model, plus an optional `instructions.md`. EVE discovers the
directory and exposes the specialist to the coordinator as a named agent tool.
Add the same ID and purpose to `agent/lib/agent-catalog.ts` so the catalog stays
useful to the coordinator and to users.

Use `agent/skills/` for reusable procedures that do not need a distinct
identity, and `agent/tools/` for typed actions or integrations.

## Design notes

This follows the useful shape of [eve-agents](https://github.com/michaelshimeles/eve-agents):
EVE owns the durable agent runtime, the filesystem is the source of truth, and
the agent surface can grow independently from a future web or messaging UI.

Named declared subagents are isolated specialists. EVE's built-in `agent` tool
can also create a fresh copy of the coordinator for ad-hoc work, while the
root-only `workflow` tool enables durable multi-agent fan-out when several
independent tracks should run together.

## Durable agents and direct chat

The web Agent Library stores spawned agent profiles in `.data/agents.json` and
stores each agent's EVE session mapping in `.data/agent-sessions.json`. These
files are local and can be moved behind SQLite or another shared database when
the vault becomes multi-user.

Built-in roles have their own EVE routes under `agent/subagents/`. User-created
agents use the dynamic `custom` EVE route; their saved profile is loaded into
that agent's instructions on each turn. Use **Chat with agent** from the Agent
Library, or select the agent in the live-chat picker, to start a direct session.

Workshop rooms fan out each new room message to every active agent in that
room. Each agent receives the room purpose, its assigned role, recent
transcript, and the new message through its own EVE session; replies are added
back to the shared transcript and Activity Timeline. Paused or blocked agents
are skipped, while invited people are currently human participants who can
read and contribute from the shared workspace. Create a room, open **Members**
to invite agents, use **Roles** to assign responsibilities, and send a message
to start the room turn. Use the trash icon in a room header to delete a room;
the safety confirmation removes its membership and transcript and selects the
next available room. Use **Transcript** to preview the complete room
conversation, copy it, or download a Markdown file for notes or handoff. Type
`@` in the room composer to mention an invited agent or person; room agents
receive the exact handles and are instructed to use them when addressing one
another.

The **Task Board** supports queued, active, blocked, and completed work. Use
**Assign task**, choose **Agent** or **Person**, select the assignee, and set a
priority. Agent-owned tasks are picked up by the background worker through
the assigned agent's EVE route, even when the browser is closed. The worker
checks EVE availability before claiming work, records its EVE session and
heartbeat, and retries failed work after a short backoff up to the saved
attempt limit. Person-owned tasks are
tracked for human follow-up and can be moved through the same status columns
manually. Use the **Task** button in a workshop room to create a task with that
room's context; it will appear on the board with a room link. Open any task
title or edit button to change its instructions, priority, or assignee. Editing
an agent task queues it for another run with the new instructions.
Active agent runs can be cancelled from their card, and blocked runs can be
retried with a fresh revision. Durable run status is projected back onto the
board so a refresh does not hide work already claimed by an agent.
Open a task to choose other tasks it must wait for. The board shows when a task
has unfinished prerequisites, and the backend refuses to claim it until those
tasks are completed. Circular or missing prerequisites are rejected.

In a room, use **Task** to create a board item with the room attached. If an
agent has already written task cards in the conversation, use **Extract tasks**
to turn recognizable numbered or owner-labelled task cards into board items;
the source message is recorded so repeated extraction does not duplicate them.
The room transcript opens in a bounded, scrollable viewer and can still be
copied or downloaded as Markdown.

Core workspace state—agents, people, rooms, tasks, and activity—is persisted in
the SQLite database `.data/agent-vault.db` (or the configured
`AGENT_VAULT_DATA_DIR`). The database uses additive migrations, revisioned
writes, and transactional updates. On first startup, an empty database imports
the existing browser workspace once; browser storage is retained only as a
temporary migration fallback.

Shared artifacts are persisted as Markdown files in the selected local
workspace folder. Click **My workspace** in the left sidebar to browse the
project root and choose a folder; the selection is saved in `.data/workspace.json`
(or the configured `AGENT_VAULT_DATA_DIR`) and is used by the artifact API and
agent artifact tools. The default remains `.data/artifacts/`, so existing vault
files continue to work. The selected folder must exist inside the project root,
which keeps local agent writes contained. EVE agents still run in isolated
sandboxes; bridging arbitrary workspace files into those sandboxes requires an
explicit file tool.

The web UI reads and writes artifacts through `/api/artifacts`; agents with the
`Artifacts` capability can list or read them, and agents with `Edit artifacts`
can create or update them with EVE approval. A multi-user deployment should
move room data, artifact metadata, and message events to a shared database
before adding realtime presence or cross-device collaboration.

Agent profiles and EVE session mappings are migrated into SQLite, with legacy
`.data/agents.json` and `.data/agent-sessions.json` imported only when their new
tables are empty. Use the workspace selector's **Export vault** action for a
portable JSON snapshot, or call `POST /api/vault/backup` to create a timestamped
recovery copy under `.data/backups/`. Normal vault activity also creates a
backup automatically every six hours by default; configure the interval with
`AGENT_VAULT_BACKUP_INTERVAL_MS`. Restore a versioned export through
`POST /api/vault/import` with an explicit `confirm: true` safety gate.

Set `AGENT_VAULT_DATA_DIR` if the durable registry should live outside the
project directory. The directory must be writable by the server process.

By default, the workspace browser is rooted at the Agent Vault project. To use
another local project as the workspace, set
`AGENT_VAULT_WORKSPACE_ROOT=/absolute/path/to/project` before starting the web
app. The UI can then browse and select any existing folder inside that root;
the server rejects paths outside it. When this variable is set, the default
storage folder is the selected workspace root rather than the vault's own
`.data/artifacts/` folder.

The profile's tools and permissions currently guide the agent's behavior and UI
configuration. Custom agents now receive only the matching EVE web and file
tools at runtime. File writes require both the `File workspace` tool and
`Edit artifacts` permission, and every write pauses for approval. `Artifacts`,
`Task board`, `Workflow`, and `External actions` are currently UI-level
configuration until their typed integrations are added.

The ChatGPT subscription model is intended for local development. EVE does not
upload this local login during deployment; switch to an AI Gateway or direct
provider model before deploying.
