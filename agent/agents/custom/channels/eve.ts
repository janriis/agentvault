import { eveChannel, defaultEveAuth } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [vercelOidc(), localDev(), placeholderAuth()],
  onMessage(ctx) {
    const agentId = ctx.eve.request.headers.get("x-vault-agent-id");
    const auth = defaultEveAuth(ctx);
    return {
      auth: auth === null || agentId === null
        ? auth
        : {
            ...auth,
            attributes: { ...auth.attributes, vaultAgentId: agentId },
          },
      context: agentId ? [JSON.stringify({ vaultAgentId: agentId })] : [],
    };
  },
});
