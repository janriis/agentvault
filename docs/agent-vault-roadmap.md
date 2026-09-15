# Agent Vault: autonomous environment roadmap

Status is recorded here as implementation proceeds. The roadmap is intentionally
phased so each increment leaves the vault more reliable than the previous one.

## Operating model

Human: create intent, constraints, preferences, and risk policy.

Agent system: clarify, plan, delegate, execute, verify, integrate, report, and
learn.

Human approval remains required for configured external, irreversible, sensitive,
or high-cost actions.

## Phases

### Phase 1 — Durable persistence foundation

Status: **Complete — 2026-09-14**

- [x] Add a persistent SQLite database in the configured data directory.
- [x] Add a schema migration table and the first additive migration.
- [x] Add a revisioned `/api/vault-state` read/write boundary.
- [x] Import existing browser state when the database is empty.
- [x] Keep browser storage only as a migration fallback during this transition.
- [x] Keep local artifact files and workspace selection compatible.
- [x] Exclude runtime data from Git.
- [x] Migrate agent profiles and EVE session mappings into SQLite with legacy import.
- [x] Add a versioned vault export endpoint and UI download action.
- [x] Add on-demand local backup creation endpoint without changing the selected artifact folder.
- [x] Add automatic backup scheduling and full import/restore.
- [x] Migrate artifact metadata into SQLite while preserving selected-folder files.
- [x] Replace browser state hydration with API-backed state for every mutation.

Implementation record:

1. Inspected current persistence: core workspace data was browser-local, while
   agent profiles, sessions, and artifacts used separate files.
2. Selected SQLite because the current product is local-first, Node 24 is the
   project runtime, and `node:sqlite` avoids another native dependency.
3. Added `agent/lib/vault-database.ts` with WAL mode, busy timeout, migrations,
   revision numbers, and transactional writes.
4. Added `app/api/vault-state/route.ts` with validation and optimistic conflict
   detection.
5. Added client hydration from the backend with legacy browser-state import.
6. Added this roadmap and phase journal to keep the work auditable.
7. Added conflict recovery so a stale browser session reloads the latest
   revision instead of overwriting another session's state.
8. Verification: `npm run typecheck` passed.
9. Verification: `npm run build` passed; Next/Turbopack reports expected
   dynamic-filesystem tracing warnings for the user-selected local workspace.
10. Verification: after a browser reload, the SQLite record remained present
    with 5 agents, 1 person, 2 rooms, 4 tasks, and the activity timeline; its
    revision advanced through normal writes rather than being recreated.
11. API restart and backup/import tests were recorded as follow-up checks for
    the initial persistence slice.
12. Added migration 2 for the agent registry and EVE session mappings; legacy
    JSON is imported only when the corresponding SQLite tables are empty.
13. Added `/api/vault/export` and an **Export vault** action in the workspace
    selector for portable recovery data.
14. Added a shared export builder and `/api/vault/backup`, which writes
    timestamped snapshots under `.data/backups` without changing the selected
    artifact folder. The UI exposes the portable export action.
15. Verification: `npm run typecheck` passed and `npm run build` passed with
    the existing dynamic-filesystem tracing warnings for configurable local
    workspaces.
16. Verification: a live `POST /api/vault/backup` returned a backup filename;
    the snapshot was valid JSON with agents, sessions, artifacts, workspace,
    and vault state, and the database reported migrations 1 and 2 plus 6 agent
    records and 15 session mappings.
17. Added migration 3 for artifact metadata. Markdown files remain in the
    selected workspace folder while their records are indexed in SQLite.
18. Added lazy automatic backups: normal vault, agent, session, and artifact
    writes create a timestamped backup when the configured interval has elapsed
    (`AGENT_VAULT_BACKUP_INTERVAL_MS`, six hours by default).
19. Added `POST /api/vault/import`. It validates the versioned export, requires
    `confirm: true`, restores the vault state, agents, sessions, and artifacts,
    and keeps the currently selected workspace folder unchanged.
20. Verification: restoring the latest local backup returned HTTP 200 with 6
    agents, 15 sessions, 4 artifacts, and a new vault revision. A restore
    request without explicit confirmation returned HTTP 400.

### Settings foundation — completed 2026-09-15

- [x] Persist global workspace, model, task, backup, and safety settings in SQLite.
- [x] Add a dedicated Settings screen with accessible controls and save feedback.
- [x] Make maximum task attempts and automatic backup intervals read the saved policy.
- [x] Reserve timeout and confirmation policy values for the persistent worker and centralized safety engine.

Implementation record:

1. Added migration 5 and a validated `vault_settings` record with safe defaults.
2. Added `/api/settings` read/write endpoints so settings are shared across browser sessions.
3. Added the Settings workspace view with workspace, model, task, backup, and safety sections.
4. Verification: `npm run typecheck` passed after adding the settings route and UI.

### Phase 2 — Reliable orchestration engine

Status: **In progress — task-run ledger and board projection slices implemented 2026-09-15**

- [x] Add a durable task-run ledger and connect assigned agent runners to it.
- [x] Reclaim stale active runs using the persisted task timeout policy.
- [x] Project durable active and completed runs back onto the Task Board.
- [x] Add explicit cancel and retry controls for agent-owned tasks.
- [ ] Define durable task state transitions and acceptance criteria.
- [ ] Add task dependencies, idempotency keys, retries, and cancellation.
- [ ] Add a persistent worker/runner for queued agent tasks.
- [ ] Detect stalled runs and resume interrupted sessions.
- [ ] Make the Task Board a projection of orchestration state.

Implementation record:

1. Read the EVE session and streaming contract before connecting task execution;
   task work uses a durable session and must tolerate reconnects and retries.
2. Added migration 4 with a SQLite `task_runs` ledger keyed by task id and
   revision, including agent, attempt, status, timestamps, result, and error.
3. Added `POST /api/tasks` for idempotent claim, completion, and failure updates;
   failures become blocked after three attempts.
4. Connected the browser task runner to claim work before sending it to EVE and
   record completion or failure after the model turn settles.
5. Verification: task claim and completion returned HTTP 200, recorded attempt
   1 and the result, and did not change the existing Task Board state.
6. Added stale-run recovery: a task whose active heartbeat is older than the
   configured timeout can be claimed again, allowing interrupted browser work
   to resume on the next runner pass.
7. Added `GET /api/tasks` and a five-second board reconciliation loop so durable
   run state survives a browser refresh and updates the visible task card.
8. Verification: `npm run typecheck` and `git diff --check` passed.
9. Added durable cancellation plus board controls for cancelling active runs
   and retrying blocked work with a fresh task revision.

### Phase 3 — Real workspace and file operations

Status: **Planned**

- [ ] Bridge the selected host workspace into controlled EVE file tools.
- [ ] Add read, write, patch, search, move, diff, and test operations.
- [ ] Enforce per-agent allowed folders and permissions.
- [ ] Record every file change against a task and agent.
- [ ] Add isolated worktrees for risky code changes.

### Phase 4 — Autonomous planning and delegation

Status: **Planned**

- [ ] Convert an idea into an intent record with constraints and desired outcome.
- [ ] Generate an executable plan and dependency graph.
- [ ] Select agents by capability, cost, availability, and risk.
- [ ] Run independent tasks in parallel and synthesize results.
- [ ] Ask humans only for ambiguity, policy, or approval decisions.

### Phase 5 — Rooms as execution environments

Status: **Planned**

- [ ] Make rooms own goals, task graphs, decisions, artifacts, and memory.
- [ ] Turn agent mentions into actionable delegation requests.
- [ ] Add live run status and room-level blockers.
- [ ] Preserve room context across sessions and restarts.

### Phase 6 — Verification and quality control

Status: **Planned**

- [ ] Require acceptance criteria for meaningful tasks.
- [ ] Add reviewer agents and automated checks.
- [ ] Prevent completion until verification passes.
- [ ] Track confidence, evidence, failed checks, and unresolved concerns.

### Phase 7 — Safety and policy engine

Status: **Planned**

- [ ] Centralize permissions and risk policies.
- [ ] Add approval queues for external and irreversible actions.
- [ ] Add budgets, rate limits, timeouts, and secret isolation.
- [ ] Keep an immutable audit trail of decisions and side effects.

### Phase 8 — Memory and continuous improvement

Status: **Planned**

- [ ] Add project, task, room, user, and agent memory scopes.
- [ ] Store decisions, rejected approaches, and successful workflows.
- [ ] Add source-linked retrieval and memory correction/deletion.
- [ ] Learn which agents and workflows perform best for each task type.

### Phase 9 — Human command center

Status: **Planned**

- [ ] Add an Idea Inbox, Run View, Approvals view, and unified activity trace.
- [ ] Show what is working, blocked, waiting, completed, or needs review.
- [ ] Make every result explainable through task, agent, tool, and artifact links.
- [ ] Measure autonomy, reliability, intervention, and recovery.

## Testing cadence

Every feature slice must include verification before it is committed:

- Unit tests for state transitions, parsers, validation, persistence, and
  retry/idempotency behavior.
- API/integration tests for route contracts, database migrations, recovery, and
  safety gates.
- Live UI smoke tests for the changed user flow, including empty, loading,
  error, and success states where applicable.
- Accessibility checks for new controls and keyboard-driven interactions.

Run the narrowest relevant checks during implementation, then run the full
typecheck, build, and affected UI smoke flow before pushing. Record each result
in the implementation record for the active phase. No feature is complete when
only the backend or only the visual surface has been tested.

## Completion rule

A phase is complete only after its acceptance criteria pass, its data path is
covered by a recovery test, and the implementation record is updated here.
