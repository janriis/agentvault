export interface WorkspaceModelSettings {
  defaultModel: "chatgpt-subscription" | "ollama";
  defaultOllamaModel: string;
  ollamaHost: string;
}

export type WorkspaceModelContext =
  | { provider: "chatgpt" }
  | { provider: "ollama"; baseUrl: string; model: string };

export function resolveWorkspaceModel(agentModel: string, settings: WorkspaceModelSettings): WorkspaceModelContext {
  const explicitLocalModel = agentModel.startsWith("Ollama · ") ? agentModel.slice("Ollama · ".length).trim() : "";
  const model = explicitLocalModel || (settings.defaultModel === "ollama" ? settings.defaultOllamaModel : "");
  if (model) return { provider: "ollama", baseUrl: settings.ollamaHost, model };
  if (settings.defaultModel === "ollama") throw new Error("Choose a local model in Settings before asking agents to work. No ChatGPT request was sent.");
  return { provider: "chatgpt" };
}

export function workspaceModelLabel(agentModel: string, settings: WorkspaceModelSettings): string {
  try {
    const selection = resolveWorkspaceModel(agentModel, settings);
    return selection.provider === "ollama" ? `Ollama · ${selection.model}` : "ChatGPT subscription";
  } catch {
    return "Ollama · choose a model in Settings";
  }
}
