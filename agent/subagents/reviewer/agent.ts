import { defineAgent } from "eve";
import { createVaultModel } from "../../lib/vault-model";

export default defineAgent({
  description:
    "Review proposed work for correctness, missing requirements, risks, and practical improvements before it is shared or acted on.",
  model: createVaultModel(),
  reasoning: "high",
});
