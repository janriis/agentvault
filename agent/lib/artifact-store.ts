import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSelectedWorkspaceDirectory } from "@/agent/lib/workspace-store";
import { listDatabaseArtifacts, replaceDatabaseArtifacts } from "@/agent/lib/vault-database";

export type StoredArtifactType = "note" | "plan" | "draft" | "file";

export interface StoredArtifact {
  id: string;
  title: string;
  type: StoredArtifactType;
  owner: string;
  updated: string;
  content: string;
}

let writeQueue = Promise.resolve();

export async function listStoredArtifacts(): Promise<StoredArtifact[]> {
  try {
    const artifactsDirectory = await getSelectedWorkspaceDirectory();
    const names = await readdir(artifactsDirectory);
    const artifacts = await Promise.all(
      names
        .filter((name) => name.endsWith(".md"))
        .map(async (name) => readArtifactFile(path.join(artifactsDirectory, name))),
    );
    const validArtifacts = artifacts
      .filter((artifact): artifact is StoredArtifact => artifact !== undefined)
      .sort((left, right) => Date.parse(right.updated) - Date.parse(left.updated));
    if (validArtifacts.length > 0) {
      replaceDatabaseArtifacts(validArtifacts.map((artifact) => ({ id: artifact.id, value: artifact })));
      return validArtifacts;
    }
    return databaseArtifacts();
  } catch {
    return databaseArtifacts();
  }
}

export async function readStoredArtifact(id: string): Promise<StoredArtifact | undefined> {
  if (!isSafeId(id)) return undefined;
  return readArtifactFile(path.join(await getSelectedWorkspaceDirectory(), `${id}.md`));
}

export function upsertStoredArtifact(artifact: StoredArtifact): Promise<void> {
  if (!isSafeId(artifact.id)) return Promise.reject(new Error("Artifact id is invalid."));
  const operation = writeQueue.then(async () => {
    const artifactsDirectory = await getSelectedWorkspaceDirectory();
    await mkdir(artifactsDirectory, { recursive: true });
    const targetPath = path.join(artifactsDirectory, `${artifact.id}.md`);
    const temporaryPath = `${targetPath}.tmp`;
    await writeFile(temporaryPath, serializeArtifact(artifact), "utf8");
    await rename(temporaryPath, targetPath);
    replaceDatabaseArtifacts([
      { id: artifact.id, value: artifact },
      ...listDatabaseArtifacts()
        .filter((record) => record.id !== artifact.id)
        .map((record) => ({ id: record.id, value: record.value })),
    ]);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export function deleteStoredArtifact(id: string): Promise<void> {
  if (!isSafeId(id)) return Promise.reject(new Error("Artifact id is invalid."));
  const operation = writeQueue.then(async () => {
    try {
      await unlink(path.join(await getSelectedWorkspaceDirectory(), `${id}.md`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

async function readArtifactFile(filePath: string): Promise<StoredArtifact | undefined> {
  try {
    const document = await readFile(filePath, "utf8");
    const header = document.match(/^<!-- agent-vault-artifact (\{.*\}) -->\n\n?/u);
    if (!header) return undefined;
    const metadata = JSON.parse(header[1]) as Partial<StoredArtifact>;
    if (!isSafeId(metadata.id) || typeof metadata.title !== "string" || !isArtifactType(metadata.type)) {
      return undefined;
    }
    return {
      id: metadata.id,
      title: metadata.title,
      type: metadata.type,
      owner: typeof metadata.owner === "string" ? metadata.owner : "Agent Vault",
      updated: typeof metadata.updated === "string" ? metadata.updated : new Date(0).toISOString(),
      content: document.slice(header[0].length),
    };
  } catch {
    return undefined;
  }
}

function databaseArtifacts(): StoredArtifact[] {
  return listDatabaseArtifacts().flatMap((record) => isStoredArtifact(record.value) ? [record.value] : []);
}

function isStoredArtifact(value: unknown): value is StoredArtifact {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Partial<StoredArtifact>;
  return isSafeId(artifact.id) && typeof artifact.title === "string" && isArtifactType(artifact.type) && typeof artifact.owner === "string" && typeof artifact.updated === "string" && typeof artifact.content === "string";
}

function serializeArtifact(artifact: StoredArtifact): string {
  const metadata = {
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    owner: artifact.owner,
    updated: artifact.updated,
  };
  return `<!-- agent-vault-artifact ${JSON.stringify(metadata)} -->\n\n${artifact.content}`;
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/u.test(value);
}

function isArtifactType(value: unknown): value is StoredArtifactType {
  return value === "note" || value === "plan" || value === "draft" || value === "file";
}
