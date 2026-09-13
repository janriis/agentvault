import { AgentChat } from "@/app/_components/agent-chat";

export default async function NewSessionPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly agentId?: string }>;
}) {
  const { agentId } = await searchParams;
  return <AgentChat initialAgentId={agentId} sessionless />;
}
