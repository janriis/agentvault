import { defineAgent } from "eve";
import { createVaultModel } from "../../lib/vault-model";

export default defineAgent({
  description:
    "Investigate questions, gather evidence, compare sources, and return findings with links, confidence, and open questions.",
  model: createVaultModel(),
  reasoning: "high",
});
