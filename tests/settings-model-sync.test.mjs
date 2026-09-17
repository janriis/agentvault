import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "agent-vault-model-settings-"));
process.env.AGENT_VAULT_DATA_DIR = dataDirectory;
const { getVaultSettings, getVaultState, listDatabaseAgents, replaceDatabaseAgents, saveVaultSettings, saveVaultState } = await import("../agent/lib/vault-database.ts");
const { workerModelContext } = await import("../agent/lib/task-orchestration.ts");
const { resolveWorkspaceModel, workspaceModelLabel } = await import("../agent/lib/workspace-model.ts");

const lead = { id: "lead", name: "Lead", role: "lead", model: "ChatGPT subscription" };
const researcher = { id: "researcher", name: "Researcher", role: "researcher", model: "ChatGPT subscription" };

test("saving an Ollama default updates existing agents in the vault and registry", () => {
  const task = { id: "existing", title: "Existing work", description: "Keep this task", assigneeId: "researcher", assigneeType: "agent", status: "queued", revision: 0 };
  const before = saveVaultState({ agents: [lead, researcher], people: [], rooms: [], tasks: [task], activity: [] });
  replaceDatabaseAgents([lead, researcher].map((agent) => ({ id: agent.id, value: agent })));

  const selected = { ...getVaultSettings(), defaultModel: "ollama", defaultOllamaModel: "llama3.2:latest" };
  const result = saveVaultSettings(selected, true);
  assert.equal(result.record.revision, before.revision + 1);
  assert.deepEqual(getVaultState().state.agents.map((agent) => agent.model), ["Ollama · llama3.2:latest", "Ollama · llama3.2:latest"]);
  assert.equal(getVaultState().state.tasks[0].id, "existing", "model changes do not replace task data");
  assert.deepEqual(listDatabaseAgents().map((agent) => agent.value.model), ["Ollama · llama3.2:latest", "Ollama · llama3.2:latest"]);
  assert.deepEqual(workerModelContext(lead), { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "llama3.2:latest" });
  assert.equal(workspaceModelLabel(lead.model, getVaultSettings()), "Ollama · llama3.2:latest");
});

test("an incomplete Ollama default never falls back to ChatGPT", () => {
  const incomplete = { ...getVaultSettings(), defaultOllamaModel: "" };
  assert.throws(() => resolveWorkspaceModel("ChatGPT subscription", incomplete), /Choose a local model/);
  assert.throws(() => saveVaultSettings(incomplete, true), /Choose an installed Ollama model/);
  assert.equal(getVaultSettings().defaultOllamaModel, "llama3.2:latest");
});

test("unrelated settings edits preserve agent assignments and switching back updates them", () => {
  const current = getVaultSettings();
  assert.equal(saveVaultSettings({ ...current, workspaceName: "Renamed" }, false).record, undefined);
  assert.equal(getVaultState().state.agents[0].model, "Ollama · llama3.2:latest");

  const result = saveVaultSettings({ ...getVaultSettings(), defaultModel: "chatgpt-subscription" }, true);
  assert.equal(result.record.state.agents[0].model, "ChatGPT subscription");
  assert.equal(listDatabaseAgents()[0].value.model, "ChatGPT subscription");
});

test.after(() => rmSync(dataDirectory, { recursive: true, force: true }));
