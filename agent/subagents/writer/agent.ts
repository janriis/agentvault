import { defineAgent } from "eve";
import { createVaultModel } from "../../lib/vault-model";

export default defineAgent({
  description:
    "Draft, edit, and adapt polished user-facing writing while preserving the requested meaning, audience, and tone.",
  model: createVaultModel(),
  reasoning: "medium",
});
