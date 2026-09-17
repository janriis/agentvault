export const CHATGPT_MODEL_ID = "chatgpt-subscription";

export interface LocalChatModel {
  id: string;
  baseUrl: string;
}

export function resolveChatModelSelection(selectedId: string, available: readonly LocalChatModel[]) {
  if (selectedId === CHATGPT_MODEL_ID) return { provider: "chatgpt" as const };
  const model = available.find((candidate) => candidate.id === selectedId);
  return model ? { provider: "ollama" as const, baseUrl: model.baseUrl, model: model.id } : undefined;
}
