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

Status: **Complete — 2026-09-15**

- [x] Add a durable task-run ledger and connect assigned agent runners to it.
- [x] Reclaim stale active runs using the persisted task timeout policy.
- [x] Project durable active and completed runs back onto the Task Board.
- [x] Add explicit cancel and retry controls for agent-owned tasks.
- [x] Add prerequisite graphs and prevent claims until they are complete.
- [x] Fence task results to the active attempt and saved task revision.
- [x] Define and enforce durable task state transitions across all board controls.
- [x] Record explicit acceptance criteria when tasks are created or edited.
- [x] Add task dependencies, idempotency keys, retries, and cancellation.
- [x] Add a local persistent worker/runner for queued agent tasks.
- [x] Detect stalled runs and resume interrupted sessions.
- [x] Make the Task Board a projection of orchestration state.

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
10. Removed SSR-unsafe relative timestamp rendering from artifact cards; the
    label is now deterministic across server render and hydration.
11. Added prerequisite editing and graph validation. Claims now check the
    persisted assignment, revision, status, and completed prerequisites.
12. Result updates require the claimed attempt, so late results from cancelled
    or superseded attempts cannot overwrite current work.
13. Verification: five focused unit and isolated SQLite integration checks
    passed, plus TypeScript and a production build. The built UI exposed the
    prerequisite field in the Task Board editor.
14. Added a standalone local task worker using `eve/client`. Development starts
    it with the web server; a separate `npm run worker -- --host ...` command
    supports an independently hosted local server. The worker checks EVE
    health before claiming, polls SQLite rather than browser state, and uses
    the same model and role context as room/task agent turns.
15. Added migration 6 for each task run's EVE session identity, plus an
    attempt-fenced heartbeat. On a stale active run, the worker inspects the
    durable EVE stream before attempting a replacement session; a completed
    result is committed against the original attempt. Missing sessions become
    failed runs rather than launching an unbounded duplicate.
16. A completed ledger run unlocks dependent tasks without requiring an open
    browser to project the completed status onto the Task Board.
17. Cancellation now fences the ledger attempt first, then requests EVE turn
    cancellation when a session is known. The UI moves a card only after the
    server accepts cancellation and surfaces a warning if EVE did not confirm.
18. Verification: seven focused unit/SQLite checks and TypeScript passed. A
    production build succeeded after the sandbox permitted Next's local CSS
    processor. The worker started against an isolated empty database, and the
    live Task Board remained readable after the browser runner was removed.
19. Added a pure run-to-board projection. SQLite reads and saves now overlay
    matching agent-run status and result, so a stale browser write cannot
    replace a completed result. Five-second UI polling uses the same function
    without creating a new state object when nothing changed.
20. New Task Board tasks require explicit acceptance criteria; editing and
    room-extracted cards carry them forward. The worker includes those criteria
    in the EVE task prompt. Legacy cards without criteria remain readable.
21. Verification: eleven focused unit/SQLite checks passed, including stale
    browser overwrite protection and task-prompt criteria. TypeScript passed,
    and the live Assign Task form showed the criteria field and kept Assign
    disabled until the required fields were supplied.
22. Updated portable exports to version 2 with task-run ledger records.
    Restoring version 2 reinstates runs before projecting vault task state;
    restoring a legacy version 1 export clears current runs rather than
    accidentally attaching them to imported task cards.
23. Verification: twelve focused unit/SQLite checks and a production build
    passed. An isolated production server on port 3999 accepted a synthetic
    completed task, exported version 2 with its run, cleared runs on version 1
    import, and restored the run plus completed Task Board status on version 2
    import. The temporary server was stopped after the check.
24. Made vault-state and task-run replacement one SQLite transaction during
    import. Invalid task graphs and duplicate run records fail before either
    durable record is changed.
25. Added transactional Task Board commands for create, edit, move, and retry,
    each with a saved idempotency key and task-revision check. Agent card
    completion requires a matching completed ledger run; editing active work
    fences its attempt and queues a new revision.
26. Routed room-generated tasks and visible board controls through the same
    command endpoint. Errors remain visible in the editor, and a conflicting
    browser session cannot overwrite task definitions through generic state
    saves. Removed the unused browser task runner.
27. Fixed repeated unchanged-state writes from the browser. In an isolated
    production UI check, the vault revision stayed unchanged during idle time;
    a stale task edit displayed a conflict and kept its editor open.
28. Recovery inspects saved EVE session IDs immediately after worker restart.
    Pending turns are not duplicated, while failed, cancelled, completed, and
    timed-out turns settle their attempt. Both live and resumed sessions use
    the configured timeout policy.
29. Vault restore clears command replay keys transactionally so an old response
    cannot be replayed against imported data.
30. Verification: 22 unit/SQLite checks, TypeScript, and a production build
    passed. Isolated API/UI checks covered a human-card move, idempotent replay,
    rejection of manual agent completion and task-definition tampering, and
    visible cross-session edit conflict. The production build retains the
    existing dynamic-workspace tracing warnings.
25. Verification: thirteen focused unit/SQLite checks, TypeScript, and a fresh
    production build passed. The isolated version 1 and version 2 API restore
    flow passed again with the transactional implementation, and the temporary
    server was stopped.

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
