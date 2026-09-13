import { defineAgent } from "eve";
import { createVaultModel } from "../../lib/vault-model";

export default defineAgent({
  description:
    "Analyze structured information, comparisons, metrics, and trade-offs to support a clear decision.",
  model: createVaultModel(),
  reasoning: "high",
});
