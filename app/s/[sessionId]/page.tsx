import { AgentChat } from "@/app/_components/agent-chat";

export default async function SessionPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly sessionId: string }>;
  readonly searchParams: Promise<{ readonly agentId?: string }>;
}) {
  const { sessionId } = await params;
  const { agentId } = await searchParams;
  return <AgentChat initialAgentId={agentId} sessionId={sessionId} />;
}
