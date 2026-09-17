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
25. Verification: thirteen focused unit/SQLite checks, TypeScript, and a fresh
    production build passed. The isolated version 1 and version 2 API restore
    flow passed again with the transactional implementation, and the temporary
    server was stopped.
26. Added transactional Task Board commands for create, edit, move, and retry,
    each with a saved idempotency key and task-revision check. Agent card
    completion requires a matching completed ledger run; editing active work
    fences its attempt and queues a new revision.
27. Routed room-generated tasks and visible board controls through the same
    command endpoint. Errors remain visible in the editor, and a conflicting
    browser session cannot overwrite task definitions through generic state
    saves. Removed the unused browser task runner.
28. Fixed repeated unchanged-state writes from the browser. In an isolated
    production UI check, the vault revision stayed unchanged during idle time;
    a stale task edit displayed a conflict and kept its editor open.
29. Recovery inspects saved EVE session IDs immediately after worker restart.
    Pending turns are not duplicated, while failed, cancelled, completed, and
    timed-out turns settle their attempt. Both live and resumed sessions use
    the configured timeout policy.
30. Vault restore clears command replay keys transactionally so an old response
    cannot be replayed against imported data.
31. Verification: 22 unit/SQLite checks, TypeScript, and a production build
    passed. Isolated API/UI checks covered a human-card move, idempotent replay,
    rejection of manual agent completion and task-definition tampering, and
    visible cross-session edit conflict. The production build retains the
    existing dynamic-workspace tracing warnings.
### Phase 3 — Real workspace and file operations

Status: **Complete — 2026-09-15**

- [x] Bridge the selected host workspace into controlled EVE file tools.
- [x] Add read, write, patch, search, move, diff, and test operations.
- [x] Enforce per-agent allowed folders and permissions.
- [x] Record every file change against a task and agent.
- [x] Add isolated worktrees for risky code changes.

Implementation record:

1. Read EVE's authored-tool, sandbox, session-context, and human-approval
   contracts. Host file access is an authored runtime bridge, not an EVE sandbox
   mount or a general chat capability.
2. Added migrations 8 and 9 for task-linked file-change audit records and
   persistent task worktree mappings. A tool call must match an active run by
   saved EVE session id, task revision, attempt, and assignee.
3. Added `workspace_file` to the root agent and specialists. It supports
   bounded text read/search, proposed-content diff, SHA-256-guarded write and
   exact-match patch, non-overwriting move, and allowlisted test scripts.
4. Restricted relative paths to the selected folder and the agent's allowed
   subfolders; hidden/managed paths, symlinks, traversal, and unassigned chat
   sessions are denied. Writes create a backup, preserve existing permissions,
   and check that the task attempt is still active before the final mutation.
5. Added Write workspace and allowed-folder controls to the agent spawner.
   Test scripts require EVE human approval; active Task Board cards link to the
   run so the user can answer in the web chat.
6. Added file-change audit reads to `/api/workspace/changes` and the Activity
   Timeline. Version 3 portable exports include the full audit metadata;
   restored worktree paths are intentionally cleared because checkout files
   themselves are not portable.
7. Added `workspace_worktree`, which creates a detached checkout from committed
   HEAD for an active task when the selected folder is a Git repository root.
   Later file calls for that task use the separate checkout; it does not copy
   uncommitted source changes or automatically delete the original checkout.
8. Verification: 31 unit/SQLite checks, TypeScript, Next production build,
   EVE discovery, and EVE production build passed. An isolated Git repository
   test confirmed that worktree edits left the original file untouched.
9. Verification: an isolated production UI showed the spawner controls, a
   synthetic task-linked file edit in Activity Timeline, and a run link on the
   Task Board. The API rejected an escaping folder with HTTP 400, and its
   version 3 export contained the synthetic file-change record. The temporary
   server and data were removed after testing.
10. Updated worker recovery for approved test runs: a human-input pause keeps
    the attempt active, the Task Board can open its EVE session, and the
    configured timeout restarts when the input is resolved rather than
    expiring immediately after a long approval wait.

Limitations: model-driven host file calls were not exercised against the real
vault to avoid subscription/API use and changes to user files. The selected
workspace remains rooted in the app project (or the
`AGENT_VAULT_WORKSPACE_ROOT` launch setting); picking an arbitrary outside
project root directly in the UI is not yet supported. Portable exports carry
audit metadata, not the bytes of arbitrary host files or Git worktrees.

### Phase 4 — Autonomous planning and delegation

Status: **Planned**

- [ ] Convert an idea into an intent record with constraints and desired outcome.
- [ ] Generate an executable plan and dependency graph.
- [ ] Select agents by capability, cost, availability, and risk.
- [ ] Run independent tasks in parallel and synthesize results.
- [ ] Ask humans only for ambiguity, policy, or approval decisions.

### Phase 5 — Rooms as execution environments

Status: **In progress — 2026-09-16**

- [ ] Make rooms own goals, task graphs, decisions, artifacts, and memory.
- [x] Turn agent mentions into actionable delegation requests.
- [ ] Add live run status and room-level blockers.
- [ ] Preserve room context across sessions and restarts.

Implementation record:

1. Added exact `@` mention routing and one-hop agent-to-agent delivery so a
   directed room request reaches only its intended specialist.
2. Added a structured Lead assignment contract. Validated task IDs are
   reassigned through the durable Task Board command path rather than inferred
   from prose.
3. Replayed one previously unanswered Lead request with user approval. The Lead
   reassigned four cards, and Researcher and Planner returned the requested
   feature briefs. This exposed a second defect: those replies were parsed as
   seven additional cards instead of results for the assigned cards.
4. Linked specialist replies to the exact assignment block that triggered
   them. A room result now completes those existing cards through the durable
   run ledger; it cannot overwrite a card already claimed by the background
   worker.
5. Marked delegated follow-up messages as ineligible for task extraction, so
   automatic and manual extraction cannot turn agent progress reports into
   duplicate cards.
6. Verification: 40 unit/SQLite checks and TypeScript passed. A production
   build passed with the existing dynamic-workspace tracing warnings, and the
   live Task Board rendered without browser console errors. No additional
   subscription-backed agent run was triggered during this verification.
7. Added shared Markdown rendering for Workshop Room messages and Activity
   Timeline details. Existing headings, paragraphs, numbered and bulleted
   lists, emphasis, links, tables, and code now render as structured content
   without migrating saved transcripts. Activity IDs now use UUIDs, while the
   list safely disambiguates older timestamp collisions. Verification: 40
   unit/SQLite checks, TypeScript, production build, and both live UI views
   passed with no browser console errors.
8. Repaired local model discovery in chat: the endpoint now uses the saved
   Ollama address and a longer discovery timeout; the picker rescans and
   retains a selected local model through temporary outages. An unavailable
   local choice blocks submission explicitly instead of silently using the
   ChatGPT subscription. Verification: 42 unit checks, TypeScript, production
   build, and a live UI rescan with five installed Ollama models. No model
   generation request was sent during testing.
9. Added a persistent return link from agent chat to the main vault screen.
   The link uses a full-page navigation because a client-side transition
   exposed a runtime error in the current Next.js preview build. Verified the
   destination renders in the live UI without a new error dialog. TypeScript,
   42 unit checks, and the production build passed.
10. Added a read-only “Check model” action to Model defaults in Settings. It
    checks the draft Ollama address without saving it or generating text, then
    reports connection failures, empty installations, or installed model names.
    The check accepts loopback addresses only. Verified 45 unit checks,
    TypeScript, production build, and live success/invalid-address UI states;
    no saved setting or model run was changed.
11. Connected the saved workspace model to existing agents, new agents, room
    conversations, direct chats, and task execution. Settings now requires a
    concrete installed Ollama model before applying a local default; the save
    updates all agent profiles and registry records in one database transaction
    without altering tasks. Incomplete local setup blocks work instead of
    falling back to ChatGPT. Verified 50 unit/SQLite checks, TypeScript, a
    production build, and live Settings, Agent Library, and chat states. No
    model generation request or user-data migration was triggered during UI
    verification.

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
