import { experimental_workflow } from "eve/tools/workflow";

// Enables durable fan-out and synthesis for tasks that benefit from multiple
// specialists working in parallel.
export default experimental_workflow({ maxSubagents: 10 });
