import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export interface WorkspaceConfig {
  rootPath: string;
  selectedPath: string;
}

export interface WorkspaceDirectory {
  name: string;
  relativePath: string;
}

const projectRoot = path.resolve(process.env.AGENT_VAULT_WORKSPACE_ROOT ?? process.cwd());
const dataDirectory = path.join(
  process.env.AGENT_VAULT_DATA_DIR ?? path.join(process.cwd(), ".data"),
);
const workspaceConfigPath = path.join(dataDirectory, "workspace.json");
const defaultSelectedPath = process.env.AGENT_VAULT_WORKSPACE_ROOT === undefined
  ? path.join(".data", "artifacts")
  : ".";

export async function getWorkspaceConfig(): Promise<WorkspaceConfig> {
  try {
    const parsed = JSON.parse(await readFile(workspaceConfigPath, "utf8")) as Partial<WorkspaceConfig>;
    const selectedPath = await validateProjectPath(parsed.selectedPath ?? defaultSelectedPath);
    return { rootPath: projectRoot, selectedPath };
  } catch {
    await mkdir(path.join(projectRoot, defaultSelectedPath === "." ? "" : defaultSelectedPath), { recursive: true }).catch(() => undefined);
    return { rootPath: projectRoot, selectedPath: defaultSelectedPath };
  }
}

export async function saveWorkspaceConfig(selectedPath: string): Promise<WorkspaceConfig> {
  const normalizedPath = await validateProjectPath(selectedPath);
  await mkdir(path.join(projectRoot, normalizedPath === "." ? "" : normalizedPath), { recursive: true });
  await mkdir(dataDirectory, { recursive: true });
  const config = { rootPath: projectRoot, selectedPath: normalizedPath } satisfies WorkspaceConfig;
  await writeFile(workspaceConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

export async function listWorkspaceDirectories(relativePath?: string): Promise<WorkspaceDirectory[]> {
  const config = await getWorkspaceConfig();
  const currentPath = await validateProjectPath(relativePath ?? config.selectedPath);
  const directory = path.join(projectRoot, currentPath === "." ? "" : currentPath);
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => ({
      name: entry.name,
      relativePath: currentPath === "." ? entry.name : path.join(currentPath, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getSelectedWorkspaceDirectory(): Promise<string> {
  const config = await getWorkspaceConfig();
  const selectedPath = await validateProjectPath(config.selectedPath);
  await mkdir(path.join(projectRoot, selectedPath === "." ? "" : selectedPath), { recursive: true });
  return path.join(projectRoot, selectedPath === "." ? "" : selectedPath);
}

async function validateProjectPath(candidate: string): Promise<string> {
  if (typeof candidate !== "string" || candidate.trim().length === 0 || path.isAbsolute(candidate)) {
    throw new Error("Workspace folders must be relative to the project root.");
  }

  const resolved = path.resolve(projectRoot, candidate);
  const relativePath = path.relative(projectRoot, resolved);
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
    throw new Error("Workspace folders must stay inside the project root.");
  }

  const [rootRealPath, candidateRealPath] = await Promise.all([
    realpath(projectRoot),
    realpath(resolved),
  ]);
  const realRelativePath = path.relative(rootRealPath, candidateRealPath);
  if (realRelativePath === ".." || realRelativePath.startsWith(`..${path.sep}`)) {
    throw new Error("Workspace folders must stay inside the project root.");
  }

  return relativePath || ".";
}
