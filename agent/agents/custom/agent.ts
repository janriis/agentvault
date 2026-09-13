import { defineAgent } from "eve";
import { createVaultModel } from "../../lib/vault-model";

export default defineAgent({
  defaultTools: false,
  model: createVaultModel(),
  reasoning: "medium",
});
