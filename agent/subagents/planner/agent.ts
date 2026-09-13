import { defineAgent } from "eve";
import { createVaultModel } from "../../lib/vault-model";

export default defineAgent({
  description:
    "Turn a goal into a practical, prioritized plan with dependencies, milestones, risks, and next actions.",
  model: createVaultModel(),
  reasoning: "high",
});
