"use client";

import type { UserContent } from "ai";
import { useEveAgent } from "eve/react";
import { AlertCircleIcon, ArrowLeftIcon, BrainIcon, PlusIcon, RefreshCwIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationTopFade,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { ThemeSwitcher } from "./theme-provider";
import { CHATGPT_MODEL_ID, resolveChatModelSelection } from "@/agent/lib/chat-model-selection";

const AGENT_NAME = "Agent Vault";
const MODEL_SELECTION_KEY = "agent-vault-model";
const CHAT_AGENT_SELECTION_KEY = "agent-vault-chat-agent";
const WORKSPACE_STORAGE_KEY = "agent-vault-workspace-v1";

interface VaultAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  model: string;
  tools: string[];
  permissions: string[];
  context?: string;
}

interface LocalModel {
  id: string;
  name: string;
  provider: "ollama";
  baseUrl: string;
  details?: string;
}

function loadSavedModelId(): string {
  try {
    return localStorage.getItem(MODEL_SELECTION_KEY) ?? CHATGPT_MODEL_ID;
  } catch {
    return CHATGPT_MODEL_ID;
  }
}

function loadVaultAgents(): VaultAgent[] {
  try {
    const saved = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved) as { agents?: VaultAgent[] };
    return Array.isArray(parsed.agents) ? parsed.agents.filter((agent) => typeof agent?.id === "string" && typeof agent?.name === "string") : [];
  } catch {
    return [];
  }
}

export function AgentChat({
  initialAgentId,
  sessionId,
  sessionless = false,
}: {
  readonly initialAgentId?: string;
  readonly sessionId?: string;
  readonly sessionless?: boolean;
}) {
  const [cancellationError, setCancellationError] = useState<string>();
  const [hasInputText, setHasInputText] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState(CHATGPT_MODEL_ID);
  const [vaultAgents, setVaultAgents] = useState<VaultAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(initialAgentId ?? "coordinator");
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelDiscoveryError, setModelDiscoveryError] = useState<string>();
  const [modelSelectionError, setModelSelectionError] = useState<string>();
  const [modelScanVersion, setModelScanVersion] = useState(0);

  useEffect(() => {
    setSelectedModelId(loadSavedModelId());
    const agents = loadVaultAgents();
    setVaultAgents(agents);
    if (initialAgentId === undefined) setSelectedAgentId("coordinator");
    void fetch("/api/agents", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { agents?: VaultAgent[] } : null)
      .then((payload) => {
        if (!payload || !Array.isArray(payload.agents)) return;
        setVaultAgents((current) => [...payload.agents!.filter((agent) => !current.some((item) => item.id === agent.id)), ...current]);
      })
      .catch(() => undefined);
  }, [initialAgentId]);

  useEffect(() => {
    let cancelled = false;
    const scan = () => {
      setModelsLoading(true);
      void fetch("/api/models", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Model discovery returned HTTP ${response.status}.`);
          return await response.json() as { models?: LocalModel[]; errors?: string[] };
        })
        .then((payload) => {
          if (cancelled) return;
          setLocalModels(Array.isArray(payload.models) ? payload.models : []);
          setModelDiscoveryError(payload.errors?.[0]);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setLocalModels([]);
          setModelDiscoveryError(error instanceof Error ? error.message : "Local model discovery failed.");
        })
        .finally(() => {
          if (!cancelled) setModelsLoading(false);
        });
    };
    scan();
    const timer = window.setInterval(scan, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [modelScanVersion]);

  const changeModel = (modelId: string) => {
    setSelectedModelId(modelId);
    setModelSelectionError(undefined);
    try {
      localStorage.setItem(MODEL_SELECTION_KEY, modelId);
    } catch {
      // Local persistence is optional; the current session still uses the choice.
    }
  };

  const changeAgent = (agentId: string) => {
    if (agentId === selectedAgentId) return;
    setSelectedAgentId(agentId);
    try {
      localStorage.setItem(CHAT_AGENT_SELECTION_KEY, agentId);
    } catch {
      // Local persistence is optional; the current chat still uses the choice.
    }
    window.location.assign(agentId === "coordinator" ? "/s" : `/s?agentId=${encodeURIComponent(agentId)}`);
  };

  const selectedVaultAgent = vaultAgents.find((agent) => agent.id === selectedAgentId);
  const selectedAgentRoute = getAgentRoute(initialAgentId);
  const agent = useEveAgent({
    ...(selectedAgentRoute ? { agent: selectedAgentRoute } : {}),
    ...(selectedAgentRoute && selectedAgentId !== "coordinator"
      ? { headers: { "x-vault-agent-id": selectedAgentId } }
      : {}),
    initialSession:
      sessionId === undefined
        ? undefined
        : {
            sessionId,
            streamIndex: 0,
          },
    resume: sessionId !== undefined,
    onSessionChange(session) {
      if (sessionId === undefined && session !== undefined) {
        // Next patches window.history to navigate, which would detach the active stream.
        History.prototype.replaceState.call(
          window.history,
          window.history.state,
          "",
          `/s/${encodeURIComponent(session.sessionId)}${selectedAgentId === "coordinator" ? "" : `?agentId=${encodeURIComponent(selectedAgentId)}`}`,
        );
      }
      if (session !== undefined && selectedAgentId !== "coordinator") {
        void fetch("/api/agent-sessions", {
          body: JSON.stringify({ agentId: selectedAgentId, eveSessionId: session.sessionId }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }).catch(() => undefined);
      }
    },
  });

  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isResuming = agent.status === "resuming";
  const isEmpty = agent.data.messages.length === 0;
  const lastMessage = agent.data.messages.at(-1);
  const isPendingAssistantShell =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.every((part) => part.type === "step-start");
  const showPendingThinking =
    isBusy &&
    (agent.status === "submitted" || lastMessage?.role !== "assistant" || isPendingAssistantShell);
  const turnFailure = isBusy || isResuming ? undefined : getLatestTurnFailure(agent.events);
  const errorMessage = modelSelectionError ?? cancellationError ?? agent.error?.message ?? turnFailure;
  const hasConversationContent = sessionless || !isEmpty || errorMessage !== undefined;
  const showConversationLayout = isResuming || hasConversationContent;
  const activeSessionId = sessionId ?? agent.session?.sessionId;

  const requestCancellation = () => {
    setCancellationError(undefined);
    void agent.cancel().catch((error: unknown) => {
      setCancellationError(toErrorMessage(error));
    });
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isResuming) return;
    const vaultModel = resolveChatModelSelection(selectedModelId, localModels);
    if (!vaultModel) {
      setModelSelectionError("That local model is not available. Start Ollama and rescan, or choose another model. No ChatGPT request was sent.");
      return;
    }

    setHasInputText(false);
    setCancellationError(undefined);
    setModelSelectionError(undefined);
    const clientContext = {
      vaultModel,
      ...(selectedAgentId !== "coordinator" ? { vaultAgentId: selectedAgentId } : {}),
      ...(selectedVaultAgent ? { vaultAgent: selectedVaultAgent } : {}),
    };
    const options = {
      ...(isBusy ? { turnPolicy: "steer" as const } : {}),
      clientContext: JSON.stringify(clientContext),
    };

    if (message.files.length === 0) {
      await agent.send(text, options);
      return;
    }

    const parts: UserContent = [];
    if (text.length > 0) {
      parts.push({ text, type: "text" });
    }
    for (const file of message.files) {
      parts.push({
        data: file.url,
        filename: file.filename,
        mediaType: file.mediaType,
        type: "file",
      });
    }

    await agent.send(parts, options);
  };

  const composer = (
    <PromptInput onSubmit={handleSubmit}>
      <PromptInputTextarea
        disabled={isResuming}
        onChange={(event) => setHasInputText(event.currentTarget.value.trim().length > 0)}
        placeholder="Send a message…"
      />
      <ComposerAction
        hasInputText={hasInputText}
        isBusy={isBusy}
        isResuming={isResuming}
        onCancel={requestCancellation}
      />
    </PromptInput>
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <Button asChild className="fixed top-3 left-4 z-30" size="sm" variant="ghost">
        <a aria-label="Back to Agent Vault" href="/"><ArrowLeftIcon className="size-4" /> <span className="hidden sm:inline">Back to vault</span></a>
      </Button>
      {showConversationLayout ? (
        <ChatHeader
          canStartNewChat={activeSessionId !== undefined}
          agents={vaultAgents}
          localModels={localModels}
          modelsLoading={modelsLoading}
          modelDiscoveryError={modelDiscoveryError}
          onAgentChange={changeAgent}
          onModelChange={changeModel}
          onRescanModels={() => setModelScanVersion((current) => current + 1)}
          selectedAgentId={selectedAgentId}
          selectedModelId={selectedModelId}
        />
      ) : null}

      {showConversationLayout ? (
        <Conversation
          className="min-h-0 flex-1"
          initial={sessionId === undefined ? undefined : false}
          resize={activeSessionId === undefined ? "smooth" : "instant"}
          scrollRestorationKey={
            isEmpty || activeSessionId === undefined
              ? undefined
              : `eve:web-chat-scroll:${activeSessionId}`
          }
        >
          <ConversationTopFade className="top-14" />
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-20 pb-36 sm:px-6">
            {agent.data.messages.map((message, index) =>
              showPendingThinking &&
              isPendingAssistantShell &&
              message.id === lastMessage.id ? null : (
                <AgentMessage
                  canRespond={!isBusy && !isResuming}
                  isStreaming={
                    agent.status === "streaming" && index === agent.data.messages.length - 1
                  }
                  key={message.id}
                  message={message}
                  onInputResponses={(inputResponses) => {
                    setCancellationError(undefined);
                    return agent.respond(inputResponses);
                  }}
                />
              ),
            )}
            {showPendingThinking ? <PendingThinking /> : null}
            {errorMessage ? <ErrorMessage message={errorMessage} /> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      ) : null}

      <div
        className={cn(
          "mx-auto w-full px-4 sm:px-6",
          showConversationLayout
            ? "fixed bottom-0 left-1/2 z-20 max-w-3xl -translate-x-1/2 bg-gradient-to-t from-background via-background to-transparent pt-4 pb-6"
            : "flex max-w-xl flex-1 flex-col items-center justify-center gap-8 pb-[10vh]",
        )}
      >
        {showConversationLayout ? null : (
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="font-medium text-5xl tracking-tighter">{AGENT_NAME}</h1>
          </div>
        )}
        {showConversationLayout ? null : (
          <div className="flex justify-center">
            <div className="flex flex-wrap justify-center gap-3">
              <AgentPicker agents={vaultAgents} onChange={changeAgent} selectedAgentId={selectedAgentId} />
              <ModelPicker error={modelDiscoveryError} localModels={localModels} loading={modelsLoading} onChange={changeModel} onRescan={() => setModelScanVersion((current) => current + 1)} selectedModelId={selectedModelId} />
            </div>
          </div>
        )}
        <div className="w-full">{composer}</div>
      </div>
    </main>
  );
}

function ComposerAction({
  hasInputText,
  isBusy,
  isResuming,
  onCancel,
}: {
  readonly hasInputText: boolean;
  readonly isBusy: boolean;
  readonly isResuming: boolean;
  readonly onCancel: () => void;
}) {
  const attachments = usePromptInputAttachments();
  const canSubmit = hasInputText || attachments.files.length > 0;

  if (!isBusy || canSubmit) {
    return <PromptInputSubmit disabled={isResuming} />;
  }

  return (
    <PromptInputButton
      aria-label="Stop"
      className="absolute right-2.5 bottom-2.5"
      onClick={onCancel}
      variant="outline"
    >
      <SquareIcon className="size-3 fill-current" />
    </PromptInputButton>
  );
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent>
        <div
          className="flex w-full items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
          role="alert"
        >
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Request failed</p>
            <p className="mt-0.5 text-muted-foreground">{message}</p>
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}

function ChatHeader({
  agents,
  canStartNewChat,
  localModels,
  modelsLoading,
  modelDiscoveryError,
  onAgentChange,
  onModelChange,
  onRescanModels,
  selectedAgentId,
  selectedModelId,
}: {
  readonly agents: VaultAgent[];
  readonly canStartNewChat: boolean;
  readonly localModels: LocalModel[];
  readonly modelsLoading: boolean;
  readonly modelDiscoveryError?: string;
  readonly onAgentChange: (agentId: string) => void;
  readonly onModelChange: (modelId: string) => void;
  readonly onRescanModels: () => void;
  readonly selectedAgentId: string;
  readonly selectedModelId: string;
}) {
  return (
    <header className="pointer-events-none fixed top-0 right-0 left-0 z-20 h-14">
      <div className="relative mx-auto flex h-full w-full max-w-3xl items-center justify-center bg-background px-24">
        <span className="truncate text-muted-foreground text-sm">{agents.find((agent) => agent.id === selectedAgentId)?.name ?? AGENT_NAME}</span>
        <div className="pointer-events-auto absolute top-2 left-24 hidden items-center gap-3 sm:flex lg:left-32">
          <AgentPicker agents={agents} onChange={onAgentChange} selectedAgentId={selectedAgentId} />
          <ModelPicker error={modelDiscoveryError} localModels={localModels} loading={modelsLoading} onChange={onModelChange} onRescan={onRescanModels} selectedModelId={selectedModelId} />
        </div>
        <div className="pointer-events-auto absolute top-3 right-32">
          <ThemeSwitcher />
        </div>
        {canStartNewChat ? (
          <Button
            aria-label="Start a new chat"
            className="pointer-events-auto fixed top-3 right-6 pr-4"
            onClick={() => window.location.assign(selectedAgentId === "coordinator" ? "/s" : `/s?agentId=${encodeURIComponent(selectedAgentId)}`)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <PlusIcon className="size-4" />
            <span className="hidden font-normal text-sm sm:inline">New chat</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function AgentPicker({ agents, onChange, selectedAgentId }: { readonly agents: VaultAgent[]; readonly onChange: (agentId: string) => void; readonly selectedAgentId: string }) {
  return <label className="flex items-center gap-2 text-muted-foreground text-xs"><span className="hidden xl:inline">Agent</span><select aria-label="Select agent" className="max-w-48 rounded-md border border-input bg-background px-2 py-1.5 text-foreground text-xs outline-none transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" onChange={(event) => onChange(event.currentTarget.value)} value={selectedAgentId}><option value="coordinator">Agent Vault · coordinator</option>{agents.length > 0 ? <optgroup label="Created agents">{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {formatAgentRole(agent.role)}</option>)}</optgroup> : null}</select></label>;
}

function ModelPicker({
  error,
  localModels,
  loading,
  onChange,
  onRescan,
  selectedModelId,
}: {
  readonly error?: string;
  readonly localModels: LocalModel[];
  readonly loading: boolean;
  readonly onChange: (modelId: string) => void;
  readonly onRescan: () => void;
  readonly selectedModelId: string;
}) {
  const selectedMissing = selectedModelId !== CHATGPT_MODEL_ID && !localModels.some((model) => model.id === selectedModelId);
  return (
    <label className="flex items-center gap-2 text-muted-foreground text-xs">
      <span className="hidden md:inline">Model</span>
      <select
        aria-label="Select model"
        className="max-w-44 rounded-md border border-input bg-background px-2 py-1.5 text-foreground text-xs outline-none transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={selectedModelId}
      >
        <option value={CHATGPT_MODEL_ID}>ChatGPT subscription</option>
        {selectedMissing ? <option disabled value={selectedModelId}>{selectedModelId} · unavailable</option> : null}
        {localModels.length > 0 ? (
          <optgroup label="Ollama · local">
            {localModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
                {model.details ? ` · ${model.details}` : ""}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <button aria-label="Rescan local models" className="rounded-md border border-input p-1.5 text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" disabled={loading} onClick={onRescan} title="Rescan local models" type="button"><RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} /></button>
      <span aria-live="polite" className="hidden text-muted-foreground lg:inline" title={error}>
        {loading ? "Scanning…" : error ? "Ollama unavailable" : localModels.length > 0 ? `${localModels.length} local` : "No local models"}
      </span>
    </label>
  );
}

function formatAgentRole(role: string) {
  return role === "custom" ? "Custom" : role.charAt(0).toUpperCase() + role.slice(1);
}

function getAgentRoute(agentId: string | undefined): string | undefined {
  if (agentId === undefined || agentId === "coordinator" || agentId === "lead") return "coordinator";
  return ["researcher", "planner", "writer", "reviewer"].includes(agentId) ? agentId : "custom";
}

function PendingThinking() {
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <div className="mb-4 flex w-full items-center gap-2 text-muted-foreground text-sm">
          <BrainIcon className="size-4" />
          <Shimmer duration={1}>Thinking</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to cancel the response.";
}

function getLatestTurnFailure(
  events: ReturnType<typeof useEveAgent>["events"],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event.type === "turn.failed") {
      return event.data.code === "MODEL_CALL_FAILED"
        ? "The model is temporarily unavailable. Please try again."
        : event.data.message;
    }

    if (event.type === "turn.completed" || event.type === "turn.cancelled") {
      return undefined;
    }

    if (event.type === "message.received") {
      return undefined;
    }
  }

  return undefined;
}
