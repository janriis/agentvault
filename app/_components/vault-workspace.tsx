"use client";

import {
  ActivityIcon,
  ArrowRightIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleDotIcon,
  ClipboardListIcon,
  Clock3Icon,
  CopyIcon,
  FileDownIcon,
  FileTextIcon,
  FolderOpenIcon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SparklesIcon,
  SquarePenIcon,
  Trash2Icon,
  UsersIcon,
  WrenchIcon,
  XIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { useEveAgent, type EveMessageData } from "eve/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Section = "overview" | "library" | "rooms" | "tasks" | "artifacts" | "activity";
type AgentStatus = "idle" | "working" | "paused" | "blocked";
type TaskStatus = "queued" | "active" | "blocked" | "completed";
type TaskAssigneeType = "agent" | "person";
type Role = "lead" | "researcher" | "planner" | "writer" | "reviewer" | "custom";
type ArtifactType = "note" | "plan" | "draft" | "file";

interface Agent {
  id: string;
  name: string;
  role: Role;
  description: string;
  capabilities: string[];
  model: string;
  tools: string[];
  permissions: string[];
  context?: string;
  status: AgentStatus;
}

interface Person {
  id: string;
  name: string;
  email: string;
}

interface DiscoveredModel {
  id: string;
  name: string;
  provider: "ollama";
  baseUrl: string;
  details?: string;
}

interface RoomMessage {
  id: string;
  author: string;
  role?: Role;
  content: string;
  time: string;
}

interface Room {
  id: string;
  name: string;
  description: string;
  agentIds: string[];
  personIds?: string[];
  roomRoles?: Record<string, string>;
  messages: RoomMessage[];
}

interface RoomTurn {
  id: string;
  content: string;
}

interface MentionTarget {
  id: string;
  name: string;
  handle: string;
  kind: "agent" | "person";
  role?: Role;
}

interface MentionContext {
  start: number;
  query: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  assigneeType: TaskAssigneeType;
  roomId?: string;
  result?: string;
  revision?: number;
  sourceKey?: string;
  status: TaskStatus;
  priority: "low" | "medium" | "high";
  updated: string;
}

interface Artifact {
  id: string;
  title: string;
  type: ArtifactType;
  owner: string;
  updated: string;
  content: string;
}

interface WorkspaceConfig {
  rootPath: string;
  selectedPath: string;
}

interface WorkspaceDirectory {
  name: string;
  relativePath: string;
}

interface ParsedTask {
  title: string;
  description: string;
  assigneeId: string;
  assigneeType: TaskAssigneeType;
  priority: Task["priority"];
  sourceKey: string;
}

interface ActivityItem {
  id: string;
  title: string;
  detail: string;
  time: string;
  kind: "decision" | "tool" | "progress" | "failure" | "safety";
  agent?: string;
}

interface VaultStatePayload {
  agents: Agent[];
  people: Person[];
  rooms: Room[];
  tasks: Task[];
  activity: ActivityItem[];
}

interface VaultStateResponse {
  record?: {
    state?: unknown;
    revision?: number;
  };
}

const STORAGE_KEY = "agent-vault-workspace-v1";
const EMPTY_PERSON_IDS: string[] = [];

async function persistArtifact(artifact: Artifact, method: "POST" | "PUT"): Promise<void> {
  const response = await fetch("/api/artifacts", {
    body: JSON.stringify(artifact),
    headers: { "Content-Type": "application/json" },
    method,
  });
  if (!response.ok) throw new Error("Artifact storage is unavailable.");
}

const initialAgents: Agent[] = [
  {
    id: "lead",
    name: "Vault Lead",
    role: "lead",
    description: "Coordinates rooms, delegates work, and keeps the vault moving.",
    capabilities: ["delegation", "synthesis", "planning"],
    model: "ChatGPT subscription",
    tools: ["Agent dispatch", "Workflow", "Web search"],
    permissions: ["Read workspace", "Create tasks"],
    status: "working",
  },
  {
    id: "researcher",
    name: "Researcher",
    role: "researcher",
    description: "Investigates questions and returns sourced, confidence-aware findings.",
    capabilities: ["web research", "source review", "fact finding"],
    model: "ChatGPT subscription",
    tools: ["Web search", "Web fetch"],
    permissions: ["Read workspace"],
    status: "idle",
  },
  {
    id: "planner",
    name: "Planner",
    role: "planner",
    description: "Turns broad goals into milestones, dependencies, and next actions.",
    capabilities: ["roadmaps", "prioritization", "risk mapping"],
    model: "ChatGPT subscription",
    tools: ["Task board", "Workflow"],
    permissions: ["Read workspace", "Create tasks"],
    status: "working",
  },
  {
    id: "writer",
    name: "Writer",
    role: "writer",
    description: "Drafts polished writing for the requested audience, voice, and channel.",
    capabilities: ["drafting", "editing", "tone adaptation"],
    model: "ChatGPT subscription",
    tools: ["Artifacts", "File workspace"],
    permissions: ["Read workspace", "Edit artifacts"],
    status: "idle",
  },
  {
    id: "reviewer",
    name: "Reviewer",
    role: "reviewer",
    description: "Stress-tests plans and drafts for gaps, risks, and correctness.",
    capabilities: ["quality review", "risk spotting", "red teaming"],
    model: "ChatGPT subscription",
    tools: ["Artifacts", "Task board"],
    permissions: ["Read workspace", "Comment artifacts"],
    status: "blocked",
  },
];

const initialPeople: Person[] = [{ id: "you", name: "You", email: "Local workspace owner" }];

const initialRooms: Room[] = [
  {
    id: "launch-room",
    name: "Agent Vault launch",
    description: "Coordinate the first useful version of the vault.",
    agentIds: ["lead", "researcher", "planner", "reviewer"],
    personIds: [],
    roomRoles: { lead: "lead", researcher: "researcher", planner: "planner", reviewer: "reviewer" },
    messages: [
      {
        id: "room-message-1",
        author: "Vault Lead",
        role: "lead",
        content: "I’ve opened this room to turn the vault idea into a practical first release.",
        time: "10:24",
      },
      {
        id: "room-message-2",
        author: "Planner",
        role: "planner",
        content: "I mapped the first milestones: library, spawning, rooms, and task visibility.",
        time: "10:27",
      },
      {
        id: "room-message-3",
        author: "Reviewer",
        role: "reviewer",
        content: "The safety gate should sit in front of external actions and destructive controls.",
        time: "10:31",
      },
    ],
  },
  {
    id: "content-room",
    name: "Content studio",
    description: "Research, draft, and review content together.",
    agentIds: ["lead", "researcher", "writer"],
    personIds: [],
    messages: [],
  },
];

const initialTasks: Task[] = [
  {
    id: "task-library",
    title: "Curate the first agent library",
    description: "Define the roles and capabilities that should ship by default.",
    assigneeId: "researcher",
    assigneeType: "agent",
    status: "completed",
    priority: "medium",
    updated: "12 min ago",
  },
  {
    id: "task-spawner",
    title: "Design the agent spawner flow",
    description: "Choose safe defaults for model, tools, permissions, and context.",
    assigneeId: "planner",
    assigneeType: "agent",
    status: "active",
    priority: "high",
    updated: "4 min ago",
  },
  {
    id: "task-safety",
    title: "Review external-action gates",
    description: "List operations that require confirmation before execution.",
    assigneeId: "reviewer",
    assigneeType: "agent",
    status: "blocked",
    priority: "high",
    updated: "18 min ago",
  },
  {
    id: "task-room",
    title: "Write workshop room playbook",
    description: "Explain how lead, research, planning, and review roles collaborate.",
    assigneeId: "writer",
    assigneeType: "agent",
    status: "queued",
    priority: "low",
    updated: "22 min ago",
  },
];

const initialArtifacts: Artifact[] = [
  {
    id: "artifact-brief",
    title: "Vault product brief",
    type: "plan",
    owner: "Vault Lead",
    updated: "8 min ago",
    content:
      "# Agent Vault product brief\n\nA workspace for spawning focused agents, giving them shared context, and keeping their work visible.\n\n## First release\n- Agent Library\n- Agent Spawner\n- Workshop Rooms\n- Task Board\n- Shared Artifacts\n- Activity Timeline",
  },
  {
    id: "artifact-safety",
    title: "Safety checklist",
    type: "note",
    owner: "Reviewer",
    updated: "18 min ago",
    content:
      "# Safety checklist\n\nAsk for confirmation before sending messages, publishing files, deleting agents, or changing external systems.\n\nRecord the decision and the actor in the activity timeline.",
  },
  {
    id: "artifact-draft",
    title: "Welcome message draft",
    type: "draft",
    owner: "Writer",
    updated: "31 min ago",
    content:
      "Welcome to Agent Vault. Start with a room, invite the specialists you need, and keep the work visible from first idea to finished artifact.",
  },
];

const initialActivity: ActivityItem[] = [
  {
    id: "activity-1",
    title: "Planner moved a task to active",
    detail: "Design the agent spawner flow",
    time: "4 min ago",
    kind: "progress",
    agent: "Planner",
  },
  {
    id: "activity-2",
    title: "Reviewer raised a safety concern",
    detail: "External-action confirmation gate is required.",
    time: "18 min ago",
    kind: "safety",
    agent: "Reviewer",
  },
  {
    id: "activity-3",
    title: "Researcher added a product brief",
    detail: "Vault product brief",
    time: "24 min ago",
    kind: "tool",
    agent: "Researcher",
  },
];

const navItems: Array<{ id: Section; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboardIcon },
  { id: "library", label: "Agent Library", icon: LibraryIcon },
  { id: "rooms", label: "Workshop Rooms", icon: UsersIcon },
  { id: "tasks", label: "Task Board", icon: ClipboardListIcon },
  { id: "artifacts", label: "Shared Artifacts", icon: FileTextIcon },
  { id: "activity", label: "Activity Timeline", icon: ActivityIcon },
];

export function VaultWorkspace() {
  const [section, setSection] = useState<Section>("overview");
  const [agents, setAgents] = useState(initialAgents);
  const [people, setPeople] = useState(initialPeople);
  const [rooms, setRooms] = useState(initialRooms);
  const [tasks, setTasks] = useState(initialTasks);
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [activity, setActivity] = useState(initialActivity);
  const [localModels, setLocalModels] = useState<DiscoveredModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedRoomId, setSelectedRoomId] = useState("launch-room");
  const [selectedArtifactId, setSelectedArtifactId] = useState("artifact-brief");
  const [search, setSearch] = useState("");
  const [showSpawner, setShowSpawner] = useState(false);
  const [showRoomCreator, setShowRoomCreator] = useState(false);
  const [showTaskCreator, setShowTaskCreator] = useState(false);
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceConfig>();
  const [backendReady, setBackendReady] = useState(false);
  const [taskRoomId, setTaskRoomId] = useState<string>();
  const artifactSaveTimers = useRef<Record<string, number>>({});
  const backendRevision = useRef(0);
  const [safetyRequest, setSafetyRequest] = useState<{
    title: string;
    detail: string;
    confirm: () => void;
  }>();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/workspace", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { workspace?: WorkspaceConfig } : null)
      .then((payload) => {
        if (!cancelled && payload?.workspace) setWorkspace(payload.workspace);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let legacyState: VaultStatePayload | undefined;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<VaultStatePayload & { tasks: Array<Partial<Task> & { agentId?: string }> }>;
        legacyState = {
          agents: Array.isArray(parsed.agents) ? parsed.agents : initialAgents,
          people: Array.isArray(parsed.people) ? parsed.people : initialPeople,
          rooms: Array.isArray(parsed.rooms) ? parsed.rooms : initialRooms,
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeStoredTask) : initialTasks,
          activity: Array.isArray(parsed.activity) ? parsed.activity : initialActivity,
        };
      }
    } catch {
      // The backend remains the source of truth if legacy browser data is invalid.
    }

    const applyState = (state: VaultStatePayload) => {
      setAgents(state.agents);
      setPeople(state.people);
      setRooms(state.rooms);
      setTasks(state.tasks);
      setActivity(state.activity);
    };

    void fetch("/api/vault-state", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { record?: { state?: unknown; revision?: number } | null } : null)
      .then(async (payload) => {
        if (cancelled) return;
        if (payload?.record?.state && isVaultStatePayload(payload.record.state)) {
          applyState(payload.record.state);
          backendRevision.current = payload.record.revision ?? 0;
          setBackendReady(true);
          return;
        }

        const state = legacyState ?? {
          agents: initialAgents,
          people: initialPeople,
          rooms: initialRooms,
          tasks: initialTasks,
          activity: initialActivity,
        };
        applyState(state);
        const saveResponse = await fetch("/api/vault-state", {
          body: JSON.stringify({ state }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (saveResponse.ok) {
          const saved = await saveResponse.json() as { record?: { revision?: number } };
          backendRevision.current = saved.record?.revision ?? 0;
        }
        setBackendReady(true);
      })
      .catch(() => {
        if (!cancelled) setBackendReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let fallbackArtifacts = initialArtifacts;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { artifacts?: Artifact[] };
        if (Array.isArray(parsed.artifacts) && parsed.artifacts.length > 0) fallbackArtifacts = parsed.artifacts;
      }
    } catch {
      // The starter artifacts remain the fallback.
    }

    void fetch("/api/artifacts", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { artifacts?: Artifact[] } : null)
      .then(async (payload) => {
        if (cancelled) return;
        const storedArtifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
        if (storedArtifacts.length > 0) {
          setArtifacts(storedArtifacts);
          return;
        }
        setArtifacts(fallbackArtifacts);
        await Promise.all(fallbackArtifacts.map((artifact) => persistArtifact(artifact, "POST")));
      })
      .catch(() => {
        // The browser cache remains available if the artifact store is offline.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/models", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { models?: DiscoveredModel[] };
      })
      .then((payload) => {
        if (cancelled) return;
        setLocalModels(Array.isArray(payload?.models) ? payload.models : []);
      })
      .catch(() => {
        if (!cancelled) setLocalModels([]);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!backendReady) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/vault-state", {
        body: JSON.stringify({
          expectedRevision: backendRevision.current,
          state: { agents, people, rooms, tasks, activity },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
        .then(async (response) => {
          if (response.ok) return await response.json() as VaultStateResponse;
          if (response.status !== 409) return null;
          const latestResponse = await fetch("/api/vault-state", { cache: "no-store" });
          return latestResponse.ok ? await latestResponse.json() as VaultStateResponse : null;
        })
        .then((payload) => {
          const record = payload?.record;
          if (record?.revision !== undefined) backendRevision.current = record.revision;
          if (record?.state && isVaultStatePayload(record.state)) {
            setAgents(record.state.agents);
            setPeople(record.state.people);
            setRooms(record.state.rooms);
            setTasks(record.state.tasks);
            setActivity(record.state.activity);
          }
        })
        .catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activity, agents, backendReady, people, rooms, tasks]);

  useEffect(() => {
    try {
      if (!backendReady) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ agents, people, rooms, tasks, artifacts, activity }));
    } catch {
      // Local workspace persistence is optional.
    }
  }, [activity, agents, artifacts, backendReady, people, rooms, tasks]);

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? rooms[0];
  const selectedArtifact =
    artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts[0];
  const activeAgents = agents.filter((agent) => agent.status === "working").length;
  const openTasks = tasks.filter((task) => task.status !== "completed").length;

  const addActivity = (item: Omit<ActivityItem, "id" | "time">) => {
    setActivity((current) => [
      { ...item, id: `activity-${Date.now()}`, time: "Just now" },
      ...current,
    ]);
  };

  const changeAgentStatus = (agentId: string, status: AgentStatus, verb: string) => {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;
    setAgents((current) => current.map((item) => (item.id === agentId ? { ...item, status } : item)));
    addActivity({
      title: `${agent.name} ${verb}`,
      detail: `Status changed to ${status}.`,
      kind: "progress",
      agent: agent.name,
    });
  };

  const controlAgent = (agentId: string, action: "pause" | "steer" | "retry" | "replace") => {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;
    if (action === "pause") {
      changeAgentStatus(agentId, agent.status === "paused" ? "working" : "paused", agent.status === "paused" ? "resumed" : "paused");
      return;
    }
    setAgents((current) => current.map((item) => (item.id === agentId ? { ...item, status: "working" } : item)));
    addActivity({
      title: `${agent.name} ${action} requested`,
      detail: action === "replace" ? "A replacement run is ready to be configured." : `The ${action} control was used.`,
      kind: action === "retry" ? "failure" : "decision",
      agent: agent.name,
    });
  };

  const requestRemoveAgent = (agentId: string) => {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent || agent.id === "lead") return;
    setSafetyRequest({
      title: `Remove ${agent.name}?`,
      detail: "This removes the agent from the library and workshop rooms. Existing artifacts remain available.",
      confirm: () => {
        setAgents((current) => current.filter((item) => item.id !== agentId));
        setRooms((current) =>
          current.map((room) => ({ ...room, agentIds: room.agentIds.filter((id) => id !== agentId) })),
        );
        addActivity({
          title: `${agent.name} was removed`,
          detail: "The user confirmed the destructive control.",
          kind: "safety",
          agent: agent.name,
        });
        setSafetyRequest(undefined);
      },
    });
  };

  const requestPublishArtifact = () => {
    if (!selectedArtifact) return;
    setSafetyRequest({
      title: `Publish “${selectedArtifact.title}”?`,
      detail: "Publishing is an external action. Confirm only when the artifact is ready to leave this local vault.",
      confirm: () => {
        addActivity({
          title: `${selectedArtifact.title} marked for publishing`,
          detail: "The user confirmed an external action.",
          kind: "safety",
        });
        setSafetyRequest(undefined);
      },
    });
  };

  const createAgent = (agent: Agent) => {
    setAgents((current) => [agent, ...current]);
    void fetch("/api/agents", {
      body: JSON.stringify(agent),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }).catch(() => undefined);
    addActivity({
      title: `${agent.name} was spawned`,
      detail: `${roleLabel(agent.role)} · ${agent.model}`,
      kind: "decision",
      agent: agent.name,
    });
    setShowSpawner(false);
    setSection("library");
  };

  const createRoom = (room: Room) => {
    setRooms((current) => [room, ...current]);
    setSelectedRoomId(room.id);
    addActivity({ title: `${room.name} was created`, detail: room.description, kind: "decision" });
    setShowRoomCreator(false);
    setSection("rooms");
  };

  const openTaskCreator = (roomId?: string) => {
    setTaskRoomId(roomId);
    setShowTaskCreator(true);
  };

  const updateRoomRoles = (roomId: string, roomRoles: Record<string, string>) => {
    setRooms((current) => current.map((room) => (room.id === roomId ? { ...room, roomRoles } : room)));
    addActivity({ title: "Room roles updated", detail: "Participant responsibilities changed in a workshop room.", kind: "decision" });
  };

  const updateRoomMembers = (roomId: string, agentIds: string[], personIds: string[], invitedPeople: Person[]) => {
    setPeople((current) => {
      const additions = invitedPeople.filter((person) => personIds.includes(person.id));
      return [...additions, ...current.filter((person) => !additions.some((addition) => addition.id === person.id))];
    });
    setRooms((current) => current.map((room) => (room.id === roomId ? { ...room, agentIds, personIds } : room)));
    addActivity({ title: "Room members updated", detail: "Agents and people were invited to or removed from a workshop room.", kind: "decision" });
  };

  const requestDeleteRoom = (roomId: string) => {
    const room = rooms.find((item) => item.id === roomId);
    if (!room) return;
    setSafetyRequest({
      title: `Delete “${room.name}”?`,
      detail: "This permanently removes the room, its membership, and its shared transcript from this local workspace.",
      confirm: () => {
        const remainingRooms = rooms.filter((item) => item.id !== roomId);
        setRooms(remainingRooms);
        if (selectedRoomId === roomId) setSelectedRoomId(remainingRooms[0]?.id ?? "");
        addActivity({
          title: `${room.name} was deleted`,
          detail: "The user confirmed the destructive room control.",
          kind: "safety",
        });
        setSafetyRequest(undefined);
      },
    });
  };

  const createTask = (task: Task) => {
    setTasks((current) => [task, ...current]);
    addActivity({
      title: `${task.title} was assigned`,
      detail: `Assigned to ${taskAssigneeName(task, agents, people)}.`,
      kind: "decision",
    });
    setShowTaskCreator(false);
    setTaskRoomId(undefined);
    setSection("tasks");
  };

  const updateTask = (updatedTask: Task) => {
    const existingTask = tasks.find((task) => task.id === updatedTask.id);
    if (!existingTask) return;
    const shouldRunAgent = updatedTask.assigneeType === "agent";
    const nextTask: Task = {
      ...updatedTask,
      status: shouldRunAgent ? "queued" : updatedTask.status,
      updated: "Just now",
      revision: (existingTask.revision ?? 0) + 1,
    };
    setTasks((current) => current.map((task) => (task.id === nextTask.id ? nextTask : task)));
    addActivity({
      title: `${nextTask.title} was updated`,
      detail: shouldRunAgent ? "New instructions queued for the assigned agent." : "Task instructions updated.",
      kind: "decision",
      agent: shouldRunAgent ? taskAssigneeName(nextTask, agents, people) : undefined,
    });
  };

  const startTask = (taskId: string, revision: number) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || (task.revision ?? 0) !== revision || task.status === "active") return;
    setTasks((current) => current.map((item) => item.id === taskId ? { ...item, status: "active", updated: "Just now" } : item));
    addActivity({ title: `${taskAssigneeName(task, agents, people)} started ${task.title}`, detail: task.description, kind: "progress", agent: taskAssigneeName(task, agents, people) });
  };

  const completeTask = (taskId: string, revision: number, result: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || (task.revision ?? 0) !== revision || task.status === "completed" || task.status === "blocked") return;
    setTasks((current) => current.map((item) => item.id === taskId ? { ...item, status: "completed", result, updated: "Just now" } : item));
    addActivity({ title: `${taskAssigneeName(task, agents, people)} completed ${task.title}`, detail: result, kind: "progress", agent: taskAssigneeName(task, agents, people) });
  };

  const blockTask = (taskId: string, revision: number, detail: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || (task.revision ?? 0) !== revision || task.status === "completed" || task.status === "blocked") return;
    setTasks((current) => current.map((item) => item.id === taskId ? { ...item, status: "blocked", updated: "Just now" } : item));
    addActivity({ title: `${taskAssigneeName(task, agents, people)} could not complete ${task.title}`, detail, kind: "failure", agent: taskAssigneeName(task, agents, people) });
  };

  const createArtifact = () => {
    const artifact: Artifact = {
      id: `artifact-${Date.now()}`,
      title: "Untitled note",
      type: "note",
      owner: "You",
      updated: "Just now",
      content: "# Untitled note\n\nStart writing here and share it with your room.",
    };
    setArtifacts((current) => [artifact, ...current]);
    void persistArtifact(artifact, "POST").catch(() => undefined);
    setSelectedArtifactId(artifact.id);
    addActivity({ title: "A new note was created", detail: artifact.title, kind: "decision" });
    setSection("artifacts");
  };

  const sendRoomMessage = (content: string) => {
    if (!selectedRoom || content.trim().length === 0) return;
    const message: RoomMessage = {
      id: `message-${Date.now()}`,
      author: "You",
      content: content.trim(),
      time: "Just now",
    };
    setRooms((current) =>
      current.map((room) => (room.id === selectedRoom.id ? { ...room, messages: [...room.messages, message] } : room)),
    );
    addActivity({ title: `You posted in ${selectedRoom.name}`, detail: content.trim(), kind: "progress" });
  };

  const createTasksFromRoom = (roomId: string, extraMessage?: RoomMessage) => {
    const room = rooms.find((item) => item.id === roomId);
    if (!room) return;
    const messages = extraMessage ? [...room.messages, extraMessage] : room.messages;
    const roomAgents = room.agentIds.map((id) => agents.find((agent) => agent.id === id)).filter((agent): agent is Agent => agent !== undefined);
    const roomPeople = (room.personIds ?? []).map((id) => people.find((person) => person.id === id)).filter((person): person is Person => person !== undefined);
    const parsedTasks = messages.flatMap((message) => parseTasksFromMessage(message, room, roomAgents, roomPeople));
    if (parsedTasks.length === 0) {
      addActivity({ title: "No task cards found", detail: `There were no recognizable task cards in ${room.name}.`, kind: "decision" });
      return;
    }
    const knownSourceKeys = new Set(tasks.map((task) => task.sourceKey).filter((key): key is string => key !== undefined));
    const newTasks = parsedTasks
      .filter((task) => !knownSourceKeys.has(task.sourceKey))
      .map((task) => ({
        ...task,
        id: `task-${Date.now()}-${task.sourceKey.replace(/[^a-z0-9]+/giu, "-").slice(-24)}`,
        roomId,
        status: "queued" as const,
        updated: "Just now",
        revision: 0,
      }));
    if (newTasks.length === 0) {
      addActivity({ title: "Task board already up to date", detail: `The task cards from ${room.name} are already on the board.`, kind: "decision" });
      return;
    }
    setTasks((current) => [...newTasks.filter((task) => !current.some((item) => item.sourceKey === task.sourceKey)), ...current]);
    addActivity({ title: `${newTasks.length} task${newTasks.length === 1 ? "" : "s"} added from ${room.name}`, detail: "Task cards were extracted from the workshop conversation.", kind: "decision" });
  };

  const appendRoomAgentMessage = (roomId: string, agentId: string, content: string) => {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent || content.trim().length === 0) return;
    const message: RoomMessage = {
      id: `message-${Date.now()}-${agentId}`,
      author: agent.name,
      role: agent.role,
      content: content.trim(),
      time: "Just now",
    };
    setRooms((current) =>
      current.map((room) => (room.id === roomId ? { ...room, messages: [...room.messages, message] } : room)),
    );
    createTasksFromRoom(roomId, message);
    addActivity({
      title: `${agent.name} replied in ${rooms.find((room) => room.id === roomId)?.name ?? "the room"}`,
      detail: content.trim(),
      kind: "progress",
      agent: agent.name,
    });
  };

  const recordRoomAgentFailure = (roomId: string, agentId: string, detail: string) => {
    const agent = agents.find((item) => item.id === agentId);
    addActivity({
      title: `${agent?.name ?? "An agent"} failed in ${rooms.find((room) => room.id === roomId)?.name ?? "the room"}`,
      detail,
      kind: "failure",
      agent: agent?.name,
    });
  };

  const updateTaskStatus = (taskId: string, status: TaskStatus) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.status === status) return;
    setTasks((current) =>
      current.map((item) => (item.id === taskId ? { ...item, status, updated: "Just now" } : item)),
    );
    addActivity({
      title: `Task moved to ${status}`,
      detail: task.title,
      kind: status === "blocked" ? "failure" : "progress",
    });
  };

  const updateArtifact = (content: string) => {
    if (!selectedArtifact) return;
    const updatedArtifact = { ...selectedArtifact, content, updated: "Just now" };
    setArtifacts((current) =>
      current.map((item) => (item.id === selectedArtifact.id ? updatedArtifact : item)),
    );
    const previousTimer = artifactSaveTimers.current[selectedArtifact.id];
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    artifactSaveTimers.current[selectedArtifact.id] = window.setTimeout(() => {
      void persistArtifact(updatedArtifact, "PUT").catch(() => undefined);
      delete artifactSaveTimers.current[selectedArtifact.id];
    }, 500);
  };

  const handleWorkspaceChanged = (nextWorkspace: WorkspaceConfig) => {
    setWorkspace(nextWorkspace);
    setShowWorkspaceSettings(false);
    setSelectedArtifactId("");
    void fetch("/api/artifacts", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { artifacts?: Artifact[] } : null)
      .then((payload) => setArtifacts(Array.isArray(payload?.artifacts) ? payload.artifacts : []))
      .catch(() => undefined);
    addActivity({
      title: "Workspace folder changed",
      detail: nextWorkspace.selectedPath === "." ? "Project root" : nextWorkspace.selectedPath,
      kind: "decision",
    });
  };

  const renderSection = () => {
    switch (section) {
      case "library":
        return (
          <LibraryView
            agents={agents}
            search={search}
            onChat={(agentId) => window.location.assign(`/s?agentId=${encodeURIComponent(agentId)}`)}
            onControl={controlAgent}
            onRemove={requestRemoveAgent}
            onSpawn={() => setShowSpawner(true)}
          />
        );
      case "rooms":
        return (
          <RoomsView
            agents={agents}
            people={people}
            rooms={rooms}
            selectedRoom={selectedRoom}
            selectedRoomId={selectedRoomId}
            onCreate={() => setShowRoomCreator(true)}
            onSelect={setSelectedRoomId}
            onSend={sendRoomMessage}
            onAgentFailure={recordRoomAgentFailure}
            onAgentMessage={appendRoomAgentMessage}
            onCreateTask={() => openTaskCreator(selectedRoomId)}
            onCreateTasksFromRoom={createTasksFromRoom}
            onDeleteRoom={requestDeleteRoom}
            onUpdateMembers={updateRoomMembers}
            onUpdateRoles={updateRoomRoles}
          />
        );
      case "tasks":
        return (
          <TasksView
            agents={agents}
            people={people}
            rooms={rooms}
            tasks={tasks}
            onChangeStatus={updateTaskStatus}
            onCreate={() => openTaskCreator()}
            onUpdateTask={updateTask}
          />
        );
      case "artifacts":
        return (
          <ArtifactsView
            artifacts={artifacts}
            selectedArtifact={selectedArtifact}
            selectedArtifactId={selectedArtifactId}
            onChange={updateArtifact}
            onCreate={createArtifact}
            onPublish={requestPublishArtifact}
            onSelect={setSelectedArtifactId}
          />
        );
      case "activity":
        return <ActivityView activity={activity} />;
      default:
        return (
          <OverviewView
            activeAgents={activeAgents}
            agents={agents}
            artifacts={artifacts}
            openTasks={openTasks}
            people={people}
            rooms={rooms}
            tasks={tasks}
            onNavigate={setSection}
            onSpawn={() => setShowSpawner(true)}
          />
        );
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-white lg:flex">
          <div className="flex h-16 items-center gap-3 border-b px-5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <SparklesIcon className="size-4" />
            </div>
            <div>
              <p className="font-semibold tracking-tight">Agent Vault</p>
              <p className="text-[11px] text-muted-foreground">Personal workspace</p>
            </div>
          </div>
          <div className="border-b p-3">
            <button
              className="flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-accent"
              onClick={() => setShowWorkspaceSettings(true)}
              type="button"
            >
              <span>
                <span className="block text-xs font-medium">My workspace</span>
                <span className="block max-w-48 truncate text-[11px] text-muted-foreground">
                  {workspace?.selectedPath ?? "Local vault"}
                </span>
              </span>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </button>
          </div>
          <nav className="flex-1 space-y-1 p-3" aria-label="Workspace navigation">
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Workspace
            </p>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    section === item.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  type="button"
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                  {item.id === "tasks" ? (
                    <span className={cn("ml-auto text-xs", section === item.id ? "opacity-80" : "opacity-60")}>
                      {openTasks}
                    </span>
                  ) : null}
                </button>
              );
            })}
            <Separator className="my-4" />
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Rooms
            </p>
            {rooms.map((room) => (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                  section === "rooms" && selectedRoomId === room.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                key={room.id}
                onClick={() => {
                  setSelectedRoomId(room.id);
                  setSection("rooms");
                }}
                type="button"
              >
                <span className="size-1.5 rounded-full bg-emerald-500" />
                <span className="truncate">{room.name}</span>
              </button>
            ))}
          </nav>
          <div className="border-t p-3">
            <a
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              href="/s"
            >
              <SquarePenIcon className="size-4" />
              Open live chat
              <ArrowRightIcon className="ml-auto size-3.5" />
            </a>
            <div className="mt-2 flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
              <div className="flex size-7 items-center justify-center rounded-full bg-slate-900 text-xs font-medium text-white">
                Y
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">You</p>
                <p className="truncate text-[11px] text-muted-foreground">Owner</p>
              </div>
              <Settings2Icon className="ml-auto size-4 text-muted-foreground" />
            </div>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-white/90 px-4 backdrop-blur sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:hidden">
                <SparklesIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{sectionTitle(section)}</p>
                <p className="hidden truncate text-xs text-muted-foreground sm:block">
                  My workspace / {workspace?.selectedPath ?? "Local vault"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <label className="relative hidden w-52 md:block">
                <SearchIcon className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
                <Input
                  className="h-9 bg-muted/30 pl-9 text-sm"
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  placeholder="Search workspace"
                  value={search}
                />
              </label>
              <Badge className="hidden gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-700 sm:inline-flex" variant="outline">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Local vault
              </Badge>
              <Button onClick={() => setShowSpawner(true)} size="sm">
                <PlusIcon />
                <span className="hidden sm:inline">Spawn agent</span>
              </Button>
              <Button aria-label="More options" size="icon-sm" variant="ghost">
                <MoreHorizontalIcon />
              </Button>
            </div>
          </header>

          <div className="border-b bg-white px-4 py-3 lg:hidden">
            <div className="flex gap-1 overflow-x-auto">
              {navItems.map((item) => (
                <button
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium",
                    section === item.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">{renderSection()}</div>
        </section>
      </div>

      <SpawnerDialog
        localModels={localModels}
        modelsLoading={modelsLoading}
        onClose={() => setShowSpawner(false)}
        onCreate={createAgent}
        open={showSpawner}
      />
      <RoomCreatorDialog onClose={() => setShowRoomCreator(false)} onCreate={createRoom} open={showRoomCreator} />
      <TaskCreatorDialog agents={agents} onClose={() => { setShowTaskCreator(false); setTaskRoomId(undefined); }} onCreate={createTask} open={showTaskCreator} people={people} room={rooms.find((item) => item.id === taskRoomId)} />
      <WorkspaceDialog
        onClose={() => setShowWorkspaceSettings(false)}
        onSelected={handleWorkspaceChanged}
        open={showWorkspaceSettings}
      />
      {tasks.filter((task) => task.assigneeType === "agent" && (task.status === "queued" || task.status === "active")).map((task) => {
        const agent = agents.find((item) => item.id === task.assigneeId);
        if (!agent) return null;
        return <TaskAgentRunner agent={agent} key={`${task.id}:${task.revision ?? 0}`} onComplete={completeTask} onFailure={blockTask} onStart={startTask} room={rooms.find((item) => item.id === task.roomId)} task={task} />;
      })}
      <Dialog open={safetyRequest !== undefined} onOpenChange={(open) => !open && setSafetyRequest(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheckIcon className="size-5 text-amber-600" />
              Confirmation required
            </DialogTitle>
            <DialogDescription>{safetyRequest?.title}</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {safetyRequest?.detail}
          </div>
          <DialogFooter>
            <Button onClick={() => setSafetyRequest(undefined)} variant="outline">
              Cancel
            </Button>
            <Button onClick={() => safetyRequest?.confirm()} variant="default">
              Confirm action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function OverviewView({
  activeAgents,
  agents,
  artifacts,
  openTasks,
  people,
  rooms,
  tasks,
  onNavigate,
  onSpawn,
}: {
  readonly activeAgents: number;
  readonly agents: Agent[];
  readonly artifacts: Artifact[];
  readonly openTasks: number;
  readonly people: Person[];
  readonly rooms: Room[];
  readonly tasks: Task[];
  readonly onNavigate: (section: Section) => void;
  readonly onSpawn: () => void;
}) {
  const activeTasks = tasks.filter((task) => task.status === "active");
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workspace pulse</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Good morning, builder.</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Keep your agents focused, your rooms aligned, and every decision visible.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => onNavigate("rooms")} variant="outline">
            <UsersIcon />
            Open a room
          </Button>
          <Button onClick={onSpawn}>
            <PlusIcon />
            Spawn an agent
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={BotIcon} label="Agents online" value={`${activeAgents}/${agents.length}`} detail="Two are working now" tone="violet" />
        <MetricCard icon={UsersIcon} label="Workshop rooms" value={String(rooms.length)} detail="Shared spaces available" tone="blue" />
        <MetricCard icon={ClipboardListIcon} label="Open tasks" value={String(openTasks)} detail="Across the task board" tone="amber" />
        <MetricCard icon={FileTextIcon} label="Shared artifacts" value={String(artifacts.length)} detail="Notes, plans, and drafts" tone="emerald" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <section className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="font-semibold">Active work</h2>
              <p className="mt-1 text-xs text-muted-foreground">What your agents are doing right now</p>
            </div>
            <Button onClick={() => onNavigate("tasks")} size="sm" variant="ghost">
              View board <ArrowRightIcon />
            </Button>
          </div>
          <div className="divide-y">
            {activeTasks.map((task) => {
              return (
                <div className="flex items-center gap-4 px-5 py-4" key={task.id}>
                  <div className="flex size-9 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                    <ZapIcon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{taskAssigneeName(task, agents, people)} · {task.updated}</p>
                  </div>
                  <StatusBadge status={task.status} />
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="font-semibold">Quick start</h2>
              <p className="mt-1 text-xs text-muted-foreground">Build your first team in minutes</p>
            </div>
            <SparklesIcon className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-2 p-4">
            <QuickAction icon={LibraryIcon} label="Browse the Agent Library" detail="Find a role for the job" onClick={() => onNavigate("library")} />
            <QuickAction icon={UsersIcon} label="Open a Workshop Room" detail="Give agents shared context" onClick={() => onNavigate("rooms")} />
            <QuickAction icon={FolderKanbanIcon} label="Review the Task Board" detail="See what is queued or blocked" onClick={() => onNavigate("tasks")} />
            <QuickAction icon={ShieldCheckIcon} label="Check safety activity" detail="Review confirmations and failures" onClick={() => onNavigate("activity")} />
          </div>
        </section>
      </div>
    </div>
  );
}

function LibraryView({
  agents,
  search,
  onChat,
  onControl,
  onRemove,
  onSpawn,
}: {
  readonly agents: Agent[];
  readonly search: string;
  readonly onChat: (agentId: string) => void;
  readonly onControl: (agentId: string, action: "pause" | "steer" | "retry" | "replace") => void;
  readonly onRemove: (agentId: string) => void;
  readonly onSpawn: () => void;
}) {
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const normalizedSearch = search.toLowerCase().trim();
  const filtered = agents.filter((agent) => {
    const matchesRole = roleFilter === "all" || agent.role === roleFilter;
    const matchesSearch =
      normalizedSearch.length === 0 ||
      [agent.name, agent.description, ...agent.capabilities].join(" ").toLowerCase().includes(normalizedSearch);
    return matchesRole && matchesSearch;
  });
  return (
    <div className="space-y-6">
      <PageIntro
        eyebrow="Agent Library"
        title="Specialists for every kind of work."
        description="Browse by role and capability, then place the right agent into a room or task."
        action={<Button onClick={onSpawn}><PlusIcon /> Spawn custom agent</Button>}
      />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["all", "lead", "researcher", "planner", "writer", "reviewer", "custom"].map((role) => (
          <button
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              roleFilter === role ? "border-primary bg-primary text-primary-foreground" : "bg-white text-muted-foreground hover:bg-accent",
            )}
            key={role}
            onClick={() => setRoleFilter(role as "all" | Role)}
            type="button"
          >
            {role === "all" ? "All agents" : roleLabel(role as Role)}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((agent) => (
          <AgentCard agent={agent} key={agent.id} onChat={onChat} onControl={onControl} onRemove={onRemove} />
        ))}
        <button className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed bg-white/60 p-6 text-center text-muted-foreground transition-colors hover:border-primary hover:bg-white" onClick={onSpawn} type="button">
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted"><PlusIcon className="size-5" /></div>
          <p className="text-sm font-medium text-foreground">Create a custom specialist</p>
          <p className="mt-1 max-w-48 text-xs">Choose its role, model, tools, and working context.</p>
        </button>
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  onChat,
  onControl,
  onRemove,
}: {
  readonly agent: Agent;
  readonly onChat: (agentId: string) => void;
  readonly onControl: (agentId: string, action: "pause" | "steer" | "retry" | "replace") => void;
  readonly onRemove: (agentId: string) => void;
}) {
  const isPaused = agent.status === "paused";
  return (
    <article className="group rounded-xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <AgentAvatar agent={agent} />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{agent.name}</h3>
            <div className="mt-1 flex items-center gap-2">
              <RoleBadge role={agent.role} />
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><span className={cn("size-1.5 rounded-full", statusDot(agent.status))} />{statusLabel(agent.status)}</span>
            </div>
          </div>
        </div>
        <Button aria-label={`More controls for ${agent.name}`} size="icon-xs" variant="ghost"><MoreHorizontalIcon /></Button>
      </div>
      <p className="mt-4 min-h-10 text-xs leading-5 text-muted-foreground">{agent.description}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {agent.capabilities.map((capability) => <Badge key={capability} variant="secondary">{capability}</Badge>)}
      </div>
      <Separator className="my-4" />
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><CircleDotIcon className="size-3.5" />{agent.model}</span>
        <span>{agent.tools.length} tools</span>
      </div>
      <Button className="mt-4 w-full" onClick={() => onChat(agent.id)} size="sm"><SquarePenIcon />Chat with agent</Button>
      <div className="mt-4 flex gap-2">
        <Button className="flex-1" onClick={() => onControl(agent.id, "pause")} size="xs" variant="outline">
          {isPaused ? <PlayIcon /> : <PauseIcon />}{isPaused ? "Resume" : "Pause"}
        </Button>
        <Button onClick={() => onControl(agent.id, "steer")} size="xs" variant="outline"><ArrowRightIcon />Steer</Button>
        <Button aria-label={`Retry ${agent.name}`} onClick={() => onControl(agent.id, "retry")} size="icon-xs" title="Retry" variant="ghost"><RefreshCwIcon /></Button>
        <Button aria-label={`Replace ${agent.name}`} onClick={() => onControl(agent.id, "replace")} size="icon-xs" title="Replace" variant="ghost"><BotIcon /></Button>
        {agent.id !== "lead" ? <Button aria-label={`Remove ${agent.name}`} onClick={() => onRemove(agent.id)} size="icon-sm" variant="ghost"><XIcon /></Button> : null}
      </div>
    </article>
  );
}

function RoomsView({
  agents,
  people,
  rooms,
  selectedRoom,
  selectedRoomId,
  onCreate,
  onSelect,
  onSend,
  onAgentFailure,
  onAgentMessage,
  onCreateTask,
  onCreateTasksFromRoom,
  onDeleteRoom,
  onUpdateMembers,
  onUpdateRoles,
}: {
  readonly agents: Agent[];
  readonly people: Person[];
  readonly rooms: Room[];
  readonly selectedRoom?: Room;
  readonly selectedRoomId: string;
  readonly onCreate: () => void;
  readonly onSelect: (roomId: string) => void;
  readonly onSend: (content: string) => void;
  readonly onAgentFailure: (roomId: string, agentId: string, detail: string) => void;
  readonly onAgentMessage: (roomId: string, agentId: string, content: string) => void;
  readonly onCreateTask: () => void;
  readonly onCreateTasksFromRoom: (roomId: string) => void;
  readonly onDeleteRoom: (roomId: string) => void;
  readonly onUpdateMembers: (roomId: string, agentIds: string[], personIds: string[], invitedPeople: Person[]) => void;
  readonly onUpdateRoles: (roomId: string, roomRoles: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-6">
      <PageIntro eyebrow="Workshop Rooms" title="Shared spaces for agents to think together." description="Bring a lead and specialists into the same working context, with roles that stay visible." action={<Button onClick={onCreate}><PlusIcon /> New room</Button>} />
      <div className="grid h-[calc(100vh-15rem)] min-h-[520px] overflow-hidden rounded-xl border bg-white shadow-sm lg:grid-cols-[260px_1fr]">
        <div className="border-b bg-muted/20 p-3 lg:border-r lg:border-b-0">
          <p className="px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your rooms</p>
          <div className="space-y-1">
            {rooms.map((room) => (
              <button className={cn("w-full rounded-lg p-3 text-left transition-colors", selectedRoomId === room.id ? "bg-primary text-primary-foreground" : "hover:bg-accent")} key={room.id} onClick={() => onSelect(room.id)} type="button">
                <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{room.name}</span><span className={cn("size-1.5 rounded-full", selectedRoomId === room.id ? "bg-emerald-300" : "bg-emerald-500")} /></div>
                <p className={cn("mt-1 truncate text-xs", selectedRoomId === room.id ? "text-primary-foreground/70" : "text-muted-foreground")}>{room.description}</p>
                <div className={cn("mt-2 flex items-center gap-1 text-[11px]", selectedRoomId === room.id ? "text-primary-foreground/70" : "text-muted-foreground")}><UsersIcon className="size-3" />{memberCount(room)} participants</div>
              </button>
            ))}
          </div>
          <button className="mt-3 flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground hover:bg-accent" onClick={onCreate} type="button"><PlusIcon className="size-3.5" />Create workshop room</button>
        </div>
        {selectedRoom ? <RoomPanel agents={agents} people={people} onAgentFailure={onAgentFailure} onAgentMessage={onAgentMessage} onCreateTask={onCreateTask} onCreateTasksFromRoom={onCreateTasksFromRoom} onDeleteRoom={onDeleteRoom} onSend={onSend} onUpdateMembers={onUpdateMembers} onUpdateRoles={onUpdateRoles} room={selectedRoom} /> : <EmptyState icon={UsersIcon} title="Create a workshop room" detail="Bring specialists together around a shared goal." />}
      </div>
    </div>
  );
}

function RoomPanel({ agents, people, room, onSend, onAgentFailure, onAgentMessage, onCreateTask, onCreateTasksFromRoom, onDeleteRoom, onUpdateMembers, onUpdateRoles }: { readonly agents: Agent[]; readonly people: Person[]; readonly room: Room; readonly onSend: (content: string) => void; readonly onAgentFailure: (roomId: string, agentId: string, detail: string) => void; readonly onAgentMessage: (roomId: string, agentId: string, content: string) => void; readonly onCreateTask: () => void; readonly onCreateTasksFromRoom: (roomId: string) => void; readonly onDeleteRoom: (roomId: string) => void; readonly onUpdateMembers: (roomId: string, agentIds: string[], personIds: string[], invitedPeople: Person[]) => void; readonly onUpdateRoles: (roomId: string, roomRoles: Record<string, string>) => void }) {
  const [draft, setDraft] = useState("");
  const [showRoles, setShowRoles] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [turn, setTurn] = useState<RoomTurn>();
  const [busyAgentIds, setBusyAgentIds] = useState<string[]>([]);
  const [mentionContext, setMentionContext] = useState<MentionContext>();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const participants = room.agentIds.map((id) => agents.find((agent) => agent.id === id)).filter((agent): agent is Agent => agent !== undefined);
  const roomPeople = (room.personIds ?? []).map((id) => people.find((person) => person.id === id)).filter((person): person is Person => person !== undefined);
  const mentionTargets = buildMentionTargets(participants, roomPeople);
  const mentionSuggestions = mentionContext === undefined
    ? []
    : mentionTargets.filter((target) => target.handle.includes(mentionContext.query.toLowerCase()) || target.name.toLowerCase().includes(mentionContext.query.toLowerCase()));
  const activeParticipants = participants.filter((agent) => agent.status !== "paused" && agent.status !== "blocked");
  const submit = () => {
    const content = draft.trim();
    if (content.length === 0) return;
    onSend(content);
    setTurn({ id: `room-turn-${Date.now()}`, content });
    setDraft("");
    setMentionContext(undefined);
  };
  const setAgentBusy = (agentId: string, busy: boolean) => {
    setBusyAgentIds((current) =>
      busy
        ? current.includes(agentId) ? current : [...current, agentId]
        : current.filter((id) => id !== agentId),
    );
  };
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex flex-col justify-between gap-3 border-b px-5 py-4 sm:flex-row sm:items-center">
        <div className="min-w-0"><div className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" /><h2 className="truncate font-semibold">{room.name}</h2></div><p className="mt-1 truncate text-xs text-muted-foreground">{room.description}</p></div>
        <div className="flex items-center gap-3"><div className="flex -space-x-2">{participants.map((agent) => <AgentAvatar agent={agent} key={agent.id} small />)}{roomPeople.map((person) => <PersonAvatar person={person} key={person.id} />)}<button aria-label="Manage room members" className="flex size-7 items-center justify-center rounded-full border-2 border-white bg-muted text-muted-foreground hover:bg-accent" onClick={() => setShowMembers(true)} type="button"><PlusIcon className="size-3" /></button></div><Button onClick={onCreateTask} size="sm" variant="outline"><ClipboardListIcon />Task</Button><Button onClick={() => onCreateTasksFromRoom(room.id)} size="sm" variant="outline" title="Extract task cards from this room"><SparklesIcon />Extract tasks</Button><Button onClick={() => setShowTranscript(true)} size="sm" variant="outline"><FileTextIcon />Transcript</Button><Button onClick={() => setShowMembers(true)} size="sm" variant="outline"><PlusIcon />Members</Button><Button onClick={() => setShowRoles((current) => !current)} size="sm" variant="outline"><Settings2Icon />Roles</Button><Button aria-label={`Delete ${room.name}`} onClick={() => onDeleteRoom(room.id)} size="icon-sm" title="Delete room" variant="ghost"><Trash2Icon /></Button></div>
      </div>
      <RoomMembersDialog agents={agents} people={people} onClose={() => setShowMembers(false)} onSave={(agentIds, personIds, invitedPeople) => { onUpdateMembers(room.id, agentIds, personIds, invitedPeople); setShowMembers(false); }} open={showMembers} selectedAgentIds={room.agentIds} selectedPersonIds={room.personIds ?? EMPTY_PERSON_IDS} />
      <RoomTranscriptDialog agents={participants} onClose={() => setShowTranscript(false)} open={showTranscript} people={roomPeople} room={room} />
      {showRoles ? <div className="grid gap-2 border-b bg-white px-5 py-3 sm:grid-cols-2">{participants.map((agent) => <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2" key={agent.id}><span className="flex min-w-0 items-center gap-2"><AgentAvatar agent={agent} small /><span className="truncate text-xs font-medium">{agent.name}</span></span><select aria-label={`Role for ${agent.name}`} className="h-8 rounded-md border bg-transparent px-2 text-xs" onChange={(event) => onUpdateRoles(room.id, { ...room.roomRoles, [agent.id]: event.currentTarget.value })} value={room.roomRoles?.[agent.id] ?? agent.role}>{["lead", "researcher", "planner", "writer", "reviewer", "custom"].map((role) => <option key={role} value={role}>{roleLabel(role as Role)}</option>)}</select></label>)}</div> : null}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain bg-[#fbfcfd] p-5">
        {room.messages.length === 0 ? <EmptyState icon={UsersIcon} title="This room is ready" detail="Invite agents and start a shared conversation." compact /> : room.messages.map((message) => <RoomMessageItem key={message.id} message={message} />)}
      </div>
      <div className="border-t bg-white p-4">
        <div className="rounded-lg border bg-muted/20 p-2 focus-within:border-ring"><Textarea ref={textareaRef} className="min-h-16 resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0" onChange={(event) => { const value = event.currentTarget.value; setDraft(value); setMentionContext(findMentionContext(value, event.currentTarget.selectionStart)); }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); submit(); return; } if (mentionSuggestions.length > 0 && (event.key === "Enter" || event.key === "Tab")) { event.preventDefault(); insertMention(draft, mentionContext, mentionSuggestions[0], setDraft, setMentionContext, textareaRef); return; } if (event.key === "Escape" && mentionContext !== undefined) { event.preventDefault(); setMentionContext(undefined); return; } }} placeholder="Message the room… Use @ to mention someone" value={draft} />{mentionSuggestions.length > 0 ? <div className="mt-1 border-t px-1 pt-1"><p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Mention someone</p><div className="grid gap-1 sm:grid-cols-2">{mentionSuggestions.slice(0, 8).map((target) => <button className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent" key={`${target.kind}:${target.id}`} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(draft, mentionContext, target, setDraft, setMentionContext, textareaRef)} type="button"><span className={cn("flex size-6 items-center justify-center rounded-full text-[9px] font-semibold text-white", target.kind === "agent" ? avatarColor(target.role) : "bg-indigo-600")}>{initials(target.name)}</span><span className="min-w-0"><span className="block truncate text-xs font-medium">@{target.handle}</span><span className="block truncate text-[10px] text-muted-foreground">{target.name}{target.role ? ` · ${roleLabel(target.role)}` : " · Person"}</span></span></button>)}</div></div> : null}<div className="flex items-center justify-between px-2 pt-1"><span className="text-[11px] text-muted-foreground">{busyAgentIds.length > 0 ? `${busyAgentIds.length} agent${busyAgentIds.length === 1 ? " is" : "s are"} thinking…` : "⌘ Enter to send · @ mentions supported"}</span><Button disabled={draft.trim().length === 0} onClick={submit} size="sm">Send <ArrowRightIcon /></Button></div></div>
      </div>
      {activeParticipants.map((agent) => <RoomAgentRunner agent={agent} key={`${room.id}:${agent.id}`} mentionTargets={mentionTargets} onFailure={(detail) => onAgentFailure(room.id, agent.id, detail)} onMessage={(content) => onAgentMessage(room.id, agent.id, content)} onStatus={(busy) => setAgentBusy(agent.id, busy)} room={room} turn={turn} />)}
    </div>
  );
}

function RoomTranscriptDialog({ agents, people, room, open, onClose }: { readonly agents: Agent[]; readonly people: Person[]; readonly room: Room; readonly open: boolean; readonly onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const transcript = buildRoomTranscript(room, agents, people);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const downloadTranscript = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([transcript], { type: "text/markdown;charset=utf-8" }));
    link.download = `${roomTranscriptFilename(room.name)}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}><DialogContent className="max-h-[90vh] max-w-3xl"><DialogHeader><DialogTitle>Transcript · {room.name}</DialogTitle><DialogDescription>Everything currently recorded in this room, including agent replies and your messages.</DialogDescription></DialogHeader><div aria-label="Room transcript" className="max-h-[60vh] overflow-y-auto rounded-md border bg-muted/10 p-4"><pre className="whitespace-pre-wrap font-mono text-xs leading-5">{transcript}</pre></div><DialogFooter><Button onClick={onClose} variant="outline">Close</Button><Button onClick={copyTranscript} variant="outline"><CopyIcon />{copied ? "Copied" : "Copy transcript"}</Button><Button onClick={downloadTranscript}><FileDownIcon />Download Markdown</Button></DialogFooter></DialogContent></Dialog>;
}

function RoomAgentRunner({ agent, mentionTargets, onFailure, onMessage, onStatus, room, turn }: { readonly agent: Agent; readonly mentionTargets: MentionTarget[]; readonly onFailure: (detail: string) => void; readonly onMessage: (content: string) => void; readonly onStatus: (busy: boolean) => void; readonly room: Room; readonly turn?: RoomTurn }) {
  const sentTurnId = useRef<string | undefined>(undefined);
  const reportedTurnId = useRef<string | undefined>(undefined);
  const route = roomAgentRoute(agent.id);
  const eveAgent = useEveAgent({
    agent: route,
    ...(route === "custom" ? { headers: { "x-vault-agent-id": agent.id } } : {}),
    onError(error) {
      onStatus(false);
      onFailure(error.message);
    },
    onFinish(snapshot) {
      onStatus(false);
      if (!turn || reportedTurnId.current === turn.id) return;
      const response = latestAssistantText(snapshot.data.messages);
      if (response.length === 0) return;
      reportedTurnId.current = turn.id;
      onMessage(response);
    },
    onSessionChange(session) {
      if (!session) return;
      void fetch("/api/agent-sessions", {
        body: JSON.stringify({ agentId: agent.id, eveSessionId: session.sessionId, roomId: room.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }).catch(() => undefined);
    },
  });

  useEffect(() => {
    if (!turn || sentTurnId.current === turn.id || eveAgent.status === "resuming") return;
    sentTurnId.current = turn.id;
    onStatus(true);
    void eveAgent.send(buildRoomPrompt(room, agent, mentionTargets, turn), {
      clientContext: JSON.stringify({
        vaultAgentId: agent.id,
        vaultAgent: agent,
        vaultModel: getRoomModelContext(agent),
      }),
    }).catch((error: unknown) => {
      onStatus(false);
      onFailure(error instanceof Error ? error.message : "The agent could not complete its room turn.");
    });
  }, [agent, eveAgent, onFailure, onStatus, room, turn]);

  return null;
}

function TaskAgentRunner({ agent, task, room, onStart, onComplete, onFailure }: { readonly agent: Agent; readonly task: Task; readonly room?: Room; readonly onStart: (taskId: string, revision: number) => void; readonly onComplete: (taskId: string, revision: number, result: string) => void; readonly onFailure: (taskId: string, revision: number, detail: string) => void }) {
  const sentRevision = useRef<number | undefined>(undefined);
  const revision = task.revision ?? 0;
  const route = roomAgentRoute(agent.id);
  const eveAgent = useEveAgent({
    agent: route,
    ...(route === "custom" ? { headers: { "x-vault-agent-id": agent.id } } : {}),
    onError(error) {
      onFailure(task.id, revision, error.message);
    },
    onFinish(snapshot) {
      const result = latestAssistantText(snapshot.data.messages);
      if (result.length > 0) onComplete(task.id, revision, result);
    },
    onSessionChange(session) {
      if (!session) return;
      void fetch("/api/agent-sessions", {
        body: JSON.stringify({ agentId: agent.id, eveSessionId: session.sessionId, roomId: room?.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }).catch(() => undefined);
    },
  });

  useEffect(() => {
    if (sentRevision.current === revision || eveAgent.status === "resuming") return;
    sentRevision.current = revision;
    onStart(task.id, revision);
    void eveAgent.send(buildTaskPrompt(task, agent, room), {
      clientContext: JSON.stringify({
        vaultAgentId: agent.id,
        vaultAgent: agent,
        vaultModel: getRoomModelContext(agent),
      }),
    }).catch((error: unknown) => {
      onFailure(task.id, revision, error instanceof Error ? error.message : "The agent could not complete its task.");
    });
  }, [agent, eveAgent, onFailure, onStart, room, revision, task]);

  return null;
}

function buildMentionTargets(agents: Agent[], people: Person[]): MentionTarget[] {
  const usedHandles = new Set<string>();
  return [
    ...agents.map((agent) => ({ id: agent.id, name: agent.name, kind: "agent" as const, role: agent.role })),
    ...people.map((person) => ({ id: person.id, name: person.name, kind: "person" as const })),
  ].map((target) => {
    const baseHandle = mentionHandle(target.name) || target.id;
    let handle = baseHandle;
    if (usedHandles.has(handle)) handle = `${baseHandle}-${mentionHandle(target.id) || "member"}`;
    usedHandles.add(handle);
    return { ...target, handle };
  });
}

function mentionHandle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

function findMentionContext(value: string, cursor: number): MentionContext | undefined {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(?:^|\s)@([a-z0-9_-]*)$/iu);
  if (!match) return undefined;
  return { start: beforeCursor.length - match[0].length + (match[0].startsWith("@") ? 0 : 1), query: match[1] ?? "" };
}

function insertMention(value: string, context: MentionContext | undefined, target: MentionTarget, setValue: (value: string) => void, setContext: (value: MentionContext | undefined) => void, textareaRef: RefObject<HTMLTextAreaElement | null>) {
  if (!context) return;
  const before = value.slice(0, context.start);
  const after = value.slice(context.start + context.query.length + 1);
  const nextValue = `${before}@${target.handle} ${after}`;
  const nextCursor = before.length + target.handle.length + 2;
  setValue(nextValue);
  setContext(findMentionContext(nextValue, nextCursor));
  requestAnimationFrame(() => {
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
  });
}

function roomAgentRoute(agentId: string): string {
  if (agentId === "lead") return "coordinator";
  return ["researcher", "planner", "writer", "reviewer"].includes(agentId) ? agentId : "custom";
}

function buildRoomTranscript(room: Room, agents: Agent[], people: Person[]): string {
  const agentNames = room.agentIds
    .map((id) => agents.find((agent) => agent.id === id)?.name)
    .filter((name): name is string => name !== undefined);
  const peopleNames = room.personIds
    ?.map((id) => people.find((person) => person.id === id)?.name)
    .filter((name): name is string => name !== undefined) ?? [];
  const participants = [...agentNames, ...peopleNames];
  const messages = room.messages.length === 0
    ? "_No messages recorded yet._"
    : room.messages.map((message) => {
        const role = message.role ? ` · ${roleLabel(message.role)}` : "";
        return `### ${message.author}${role} · ${message.time}\n\n${message.content}`;
      }).join("\n\n");
  return [
    `# ${room.name}`,
    room.description,
    `Participants: ${participants.length > 0 ? participants.join(", ") : "None"}`,
    "",
    "## Conversation",
    messages,
    "",
    "_Exported from Agent Vault._",
  ].join("\n\n");
}

function roomTranscriptFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room-transcript";
}

function getRoomModelContext(agent: Agent): { provider: "chatgpt" } | { provider: "ollama"; baseUrl: string; model: string } {
  if (agent.model.startsWith("Ollama · ")) {
    return {
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: agent.model.slice("Ollama · ".length),
    };
  }
  return { provider: "chatgpt" };
}

function buildRoomPrompt(room: Room, agent: Agent, mentionTargets: MentionTarget[], turn: RoomTurn): string {
  const role = room.roomRoles?.[agent.id] ?? agent.role;
  const transcript = room.messages
    .slice(-12)
    .map((message) => `${message.author}${message.role ? ` (${message.role})` : ""}: ${message.content}`)
    .join("\n");
  return [
    `You are participating in the workshop room “${room.name}” as the ${role} role.`,
    room.description,
    agent.context ?? agent.description,
    "Contribute directly to this room's shared work. Do not describe yourself as the general coordinator and do not repeat the entire transcript.",
    `Room participant handles:\n${mentionTargets.map((target) => `- @${target.handle}: ${target.name}${target.role ? ` (${room.roomRoles?.[target.id] ?? target.role})` : " (person)"}`).join("\n")}\nUse the exact @handle when directly addressing another participant. Do not invent handles.`,
    transcript.length > 0 ? `Recent room transcript:\n${transcript}` : "There is no earlier transcript yet.",
    `New message from You:\n${turn.content}`,
    "Return one focused contribution for the other room participants. Mention concrete next steps, evidence, drafts, risks, or questions that fit your role.",
  ].join("\n\n");
}

function buildTaskPrompt(task: Task, agent: Agent, room?: Room): string {
  return [
    `You are ${agent.name}, working as the ${agent.role} specialist in Agent Vault.`,
    agent.context ?? agent.description,
    `Assigned task: ${task.title}`,
    `Instructions:
${task.description}`,
    room ? `This task came from the workshop room “${room.name}”. Room purpose: ${room.description}` : "This task was assigned from the Agent Vault task board.",
    "Start working on the task now. Return a concise progress update or completed result with concrete findings, decisions, files, or next steps. Do not only describe how you would approach it.",
  ].join("\n\n");
}

function latestAssistantText(messages: EveMessageData["messages"]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function TasksView({ agents, people, rooms, tasks, onChangeStatus, onCreate, onUpdateTask }: { readonly agents: Agent[]; readonly people: Person[]; readonly rooms: Room[]; readonly tasks: Task[]; readonly onChangeStatus: (taskId: string, status: TaskStatus) => void; readonly onCreate: () => void; readonly onUpdateTask: (task: Task) => void }) {
  const [draggedTaskId, setDraggedTaskId] = useState<string>();
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus>();
  const [editingTask, setEditingTask] = useState<Task>();
  const columns: Array<{ status: TaskStatus; label: string; icon: LucideIcon }> = [
    { status: "queued", label: "Queued", icon: Clock3Icon },
    { status: "active", label: "Active", icon: ZapIcon },
    { status: "blocked", label: "Blocked", icon: CircleAlertIcon },
    { status: "completed", label: "Completed", icon: CheckCircle2Icon },
  ];
  return (
    <div className="space-y-6">
      <PageIntro eyebrow="Task Board" title="Make the work legible." description="Assign work, drag cards between statuses, and surface blocked tasks before they disappear." action={<Button onClick={onCreate}><PlusIcon /> Assign task</Button>} />
      <div className="grid gap-4 xl:grid-cols-4">
        {columns.map((column) => { const Icon = column.icon; const columnTasks = tasks.filter((task) => task.status === column.status); const isDropTarget = dragOverStatus === column.status && draggedTaskId !== undefined; return <section className={cn("min-h-96 rounded-xl border bg-white p-3 shadow-sm transition-colors", isDropTarget && "border-primary bg-primary/5")} key={column.status} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOverStatus(column.status); }} onDrop={(event) => { event.preventDefault(); const taskId = event.dataTransfer.getData("text/plain"); if (taskId) onChangeStatus(taskId, column.status); setDraggedTaskId(undefined); setDragOverStatus(undefined); }}><div className="flex items-center justify-between px-2 py-2"><div className="flex items-center gap-2"><Icon className={cn("size-4", taskTone(column.status))} /><h2 className="text-sm font-semibold">{column.label}</h2><span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{columnTasks.length}</span></div><Button aria-label={`More ${column.label} options`} size="icon-xs" variant="ghost"><MoreHorizontalIcon /></Button></div><div className="mt-2 space-y-3">{columnTasks.map((task) => <TaskCard agents={agents} isDragging={draggedTaskId === task.id} key={task.id} onChangeStatus={onChangeStatus} onDragEnd={() => { setDraggedTaskId(undefined); setDragOverStatus(undefined); }} onDragStart={(taskId) => setDraggedTaskId(taskId)} onEdit={() => setEditingTask(task)} people={people} room={rooms.find((room) => room.id === task.roomId)} task={task} />)}</div>{columnTasks.length === 0 ? <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">Drop a task here</div> : null}</section>; })}
      </div>
      <TaskEditorDialog agents={agents} onClose={() => setEditingTask(undefined)} onSave={(task) => { onUpdateTask(task); setEditingTask(undefined); }} people={people} room={editingTask ? rooms.find((room) => room.id === editingTask.roomId) : undefined} task={editingTask} />
    </div>
  );
}

function TaskCard({ agents, isDragging, people, room, task, onChangeStatus, onDragEnd, onDragStart, onEdit }: { readonly agents: Agent[]; readonly isDragging: boolean; readonly people: Person[]; readonly room?: Room; readonly task: Task; readonly onChangeStatus: (taskId: string, status: TaskStatus) => void; readonly onDragEnd: () => void; readonly onDragStart: (taskId: string) => void; readonly onEdit: () => void }) {
  const agent = task.assigneeType === "agent" ? agents.find((item) => item.id === task.assigneeId) : undefined;
  const person = task.assigneeType === "person" ? people.find((item) => item.id === task.assigneeId) : undefined;
  const nextStatus: TaskStatus = task.status === "queued" ? "active" : task.status === "active" ? "completed" : task.status === "blocked" ? "active" : "queued";
  return <article className={cn("cursor-grab rounded-lg border bg-white p-3 shadow-xs transition-all hover:shadow-sm active:cursor-grabbing", isDragging && "scale-[.98] opacity-50")} draggable onDragEnd={onDragEnd} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); onDragStart(task.id); }}><div className="flex items-start justify-between gap-2"><button className="min-w-0 text-left text-sm font-medium leading-5 hover:text-primary" onClick={onEdit} title="Edit task" type="button">{task.title}</button><PriorityBadge priority={task.priority} /></div><p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{task.description}</p>{task.result ? <p className="mt-2 line-clamp-2 rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] leading-4 text-emerald-800"><span className="font-medium">Latest result:</span> {task.result}</p> : null}{room ? <p className="mt-2 truncate text-[10px] text-muted-foreground">From {room.name}</p> : null}<div className="mt-3 flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">{agent ? <AgentAvatar agent={agent} small /> : person ? <PersonAvatar person={person} /> : <div className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted text-xs">?</div>}<span className="truncate">{agent?.name ?? person?.name ?? "Unassigned"}</span><Badge className="shrink-0 text-[9px]" variant="outline">{task.assigneeType === "person" ? "Person" : "Agent"}</Badge></div><div className="flex items-center gap-1"><Button onClick={onEdit} size="icon-xs" variant="ghost" title="Edit task"><SquarePenIcon /></Button><Button onClick={() => onChangeStatus(task.id, nextStatus)} size="icon-xs" variant="ghost" title={`Move to ${nextStatus}`}><ChevronRightIcon /></Button></div></div></article>;
}

function ArtifactsView({ artifacts, selectedArtifact, selectedArtifactId, onChange, onCreate, onPublish, onSelect }: { readonly artifacts: Artifact[]; readonly selectedArtifact?: Artifact; readonly selectedArtifactId: string; readonly onChange: (content: string) => void; readonly onCreate: () => void; readonly onPublish: () => void; readonly onSelect: (artifactId: string) => void }) {
  return <div className="space-y-6"><PageIntro eyebrow="Shared Artifacts" title="One place for the work your agents create." description="Keep notes, plans, drafts, files, and outputs connected to the room that produced them." action={<Button onClick={onCreate}><PlusIcon /> New artifact</Button>} /><div className="grid min-h-[620px] overflow-hidden rounded-xl border bg-white shadow-sm lg:grid-cols-[280px_1fr]"><div className="border-b bg-muted/20 p-3 lg:border-r lg:border-b-0"><div className="flex items-center justify-between px-2 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Recent artifacts</p><Button aria-label="Add artifact" onClick={onCreate} size="icon-xs" variant="ghost"><PlusIcon /></Button></div><div className="space-y-1">{artifacts.map((artifact) => <button className={cn("w-full rounded-lg p-3 text-left", selectedArtifactId === artifact.id ? "bg-primary text-primary-foreground" : "hover:bg-accent")} key={artifact.id} onClick={() => onSelect(artifact.id)} type="button"><div className="flex items-center gap-2"><ArtifactIcon type={artifact.type} /><span className="truncate text-sm font-medium">{artifact.title}</span></div><p className={cn("mt-1 pl-6 text-[11px]", selectedArtifactId === artifact.id ? "text-primary-foreground/70" : "text-muted-foreground")}>{artifact.owner} · {artifactUpdatedLabel(artifact.updated)}</p></button>)}</div></div>{selectedArtifact ? <div className="flex min-w-0 flex-col"><div className="flex flex-col justify-between gap-3 border-b px-5 py-4 sm:flex-row sm:items-center"><div><div className="flex items-center gap-2"><ArtifactIcon type={selectedArtifact.type} /><h2 className="font-semibold">{selectedArtifact.title}</h2></div><p className="mt-1 text-xs text-muted-foreground">Owned by {selectedArtifact.owner} · Edited {artifactUpdatedLabel(selectedArtifact.updated)}</p></div><div className="flex gap-2"><Button onClick={onPublish} size="sm" variant="outline"><ArrowRightIcon /> Publish</Button><Button size="icon-sm" variant="ghost"><MoreHorizontalIcon /></Button></div></div><div className="flex-1 bg-[#fbfcfd] p-5"><Textarea className="h-full min-h-[480px] resize-none border-0 bg-transparent p-0 font-mono text-sm leading-6 shadow-none focus-visible:ring-0" onChange={(event) => onChange(event.currentTarget.value)} value={selectedArtifact.content} /></div></div> : <EmptyState icon={FileTextIcon} title="No artifact selected" detail="Create a note, plan, draft, or file to share with your agents." />}</div></div>;
}

function ActivityView({ activity }: { readonly activity: ActivityItem[] }) {
  const [filter, setFilter] = useState<"all" | ActivityItem["kind"]>("all");
  const filtered = activity.filter((item) => filter === "all" || item.kind === filter);
  return <div className="space-y-6"><PageIntro eyebrow="Activity Timeline" title="See how the vault is behaving." description="Decisions, tool usage, progress, failures, and safety confirmations in one trace." action={<Button variant="outline"><RefreshCwIcon /> Refresh</Button>} /><div className="flex gap-2 overflow-x-auto pb-1">{["all", "decision", "tool", "progress", "failure", "safety"].map((kind) => <button className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium", filter === kind ? "border-primary bg-primary text-primary-foreground" : "bg-white text-muted-foreground hover:bg-accent")} key={kind} onClick={() => setFilter(kind as "all" | ActivityItem["kind"])} type="button">{kind === "all" ? "All activity" : activityLabel(kind as ActivityItem["kind"])}</button>)}</div><section className="rounded-xl border bg-white shadow-sm"><div className="divide-y">{filtered.map((item) => <ActivityRow item={item} key={item.id} />)}</div></section></div>;
}

function ActivityRow({ item }: { readonly item: ActivityItem }) { const Icon = activityIcon(item.kind); return <div className="flex gap-4 px-5 py-4"><div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", activityTone(item.kind))}><Icon className="size-4" /></div><div className="min-w-0 flex-1"><div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center"><p className="text-sm font-medium">{item.title}</p><span className="text-[11px] text-muted-foreground">{item.time}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>{item.agent ? <Badge className="mt-2" variant="secondary">{item.agent}</Badge> : null}</div></div>; }

function WorkspaceDialog({ open, onClose, onSelected }: { readonly open: boolean; readonly onClose: () => void; readonly onSelected: (workspace: WorkspaceConfig) => void }) {
  const [currentPath, setCurrentPath] = useState(".");
  const [rootPath, setRootPath] = useState("");
  const [entries, setEntries] = useState<WorkspaceDirectory[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void fetch("/api/workspace", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { error?: string; workspace?: WorkspaceConfig; currentPath?: string; entries?: WorkspaceDirectory[] };
        if (!response.ok) throw new Error(payload.error ?? "Workspace folders could not be loaded.");
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        setRootPath(payload.workspace?.rootPath ?? "");
        setCurrentPath(payload.currentPath ?? payload.workspace?.selectedPath ?? ".");
        setEntries(Array.isArray(payload.entries) ? payload.entries : []);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Workspace folders could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const browse = (relativePath: string) => {
    setLoading(true);
    setError(undefined);
    void fetch(`/api/workspace?path=${encodeURIComponent(relativePath)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { error?: string; currentPath?: string; entries?: WorkspaceDirectory[] };
        if (!response.ok) throw new Error(payload.error ?? "That folder could not be opened.");
        return payload;
      })
      .then((payload) => {
        setCurrentPath(payload.currentPath ?? relativePath);
        setEntries(Array.isArray(payload.entries) ? payload.entries : []);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "That folder could not be opened."))
      .finally(() => setLoading(false));
  };

  const parentPath = currentPath === "." ? undefined : currentPath.split(/[\\/]/u).slice(0, -1).join("/") || ".";

  const selectFolder = () => {
    setSelecting(true);
    setError(undefined);
    void fetch("/api/workspace", {
      body: JSON.stringify({ relativePath: currentPath }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then(async (response) => {
        const payload = await response.json() as { error?: string; workspace?: WorkspaceConfig };
        if (!response.ok || !payload.workspace) throw new Error(payload.error ?? "That folder could not be selected.");
        return payload.workspace;
      })
      .then(onSelected)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "That folder could not be selected."))
      .finally(() => setSelecting(false));
  };

  return <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}><DialogContent className="flex max-h-[min(80vh,700px)] flex-col sm:max-w-xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><FolderOpenIcon className="size-5 text-muted-foreground" /> Choose local workspace folder</DialogTitle><DialogDescription>Agent Vault stores shared artifacts in the folder you select. Browse folders inside this project and choose the location that should hold the vault files.</DialogDescription></DialogHeader><div className="min-h-0 space-y-4 overflow-y-auto"><div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs font-medium">Project root</p><p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{rootPath || "Loading…"}</p></div><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium">Browsing</p><p className="truncate font-mono text-xs text-muted-foreground">{currentPath === "." ? "Project root" : currentPath}</p></div><div className="flex shrink-0 gap-2">{parentPath ? <Button onClick={() => browse(parentPath)} size="sm" variant="outline">Up</Button> : null}<Button disabled={currentPath === "."} onClick={() => browse(".")} size="sm" variant="ghost">Project root</Button></div></div>{error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}<div className="min-h-40 rounded-lg border">{loading ? <p className="p-4 text-sm text-muted-foreground">Loading folders…</p> : entries.length > 0 ? <div className="divide-y">{entries.map((entry) => <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent" key={entry.relativePath} onClick={() => browse(entry.relativePath)} type="button"><FolderOpenIcon className="size-4 text-muted-foreground" /><span className="truncate">{entry.name}</span><ChevronRightIcon className="ml-auto size-4 text-muted-foreground" /></button>)}</div> : <p className="p-4 text-sm text-muted-foreground">No subfolders here. This folder can still be used for artifacts.</p>}</div><p className="text-xs leading-5 text-muted-foreground">Selected folder: <span className="font-medium text-foreground">{currentPath === "." ? "Project root" : currentPath}</span>. Agent sandbox files remain isolated by EVE; this setting controls Agent Vault’s local artifact storage.</p></div><DialogFooter><a className="mr-auto inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground" download href="/api/vault/export"><FileDownIcon className="size-4" /> Export vault</a><Button onClick={onClose} variant="outline">Cancel</Button><Button disabled={loading || selecting} onClick={selectFolder}><FolderOpenIcon />{selecting ? "Selecting…" : "Use this folder"}</Button></DialogFooter></DialogContent></Dialog>;
}

function SpawnerDialog({ open, onClose, onCreate, localModels, modelsLoading }: { readonly open: boolean; readonly onClose: () => void; readonly onCreate: (agent: Agent) => void; readonly localModels: DiscoveredModel[]; readonly modelsLoading: boolean }) {
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [role, setRole] = useState<Role>("custom");
  const [model, setModel] = useState("ChatGPT subscription");
  const [context, setContext] = useState("Work from the shared room context and report decisions clearly.");
  const [tools, setTools] = useState(["Artifacts", "Task board"]);
  const [permissions, setPermissions] = useState(["Read workspace"]);
  const toggle = (value: string, current: string[], setCurrent: (value: string[]) => void) => setCurrent(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  const create = () => { const cleanName = name.trim(); if (!cleanName) return; onCreate({ id: `custom-${Date.now()}`, name: cleanName, role, description: job.trim() || context, capabilities: [roleLabel(role).toLowerCase(), "shared context", "focused execution"], model, tools, permissions, context, status: "idle" }); setName(""); setJob(""); };
  return <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Spawn an agent</DialogTitle><DialogDescription>Configure a focused specialist for a job, room, or task.</DialogDescription></DialogHeader><div className="grid gap-5 sm:grid-cols-2"><div className="space-y-4"><Field label="Agent name"><Input onChange={(event) => setName(event.currentTarget.value)} placeholder="e.g. Competitor Scout" value={name} /></Field><Field label="Job / mission"><Input onChange={(event) => setJob(event.currentTarget.value)} placeholder="What should this agent accomplish?" value={job} /></Field><Field label="Role"><select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" onChange={(event) => setRole(event.currentTarget.value as Role)} value={role}>{["custom", "lead", "researcher", "planner", "writer", "reviewer"].map((value) => <option key={value} value={value}>{roleLabel(value as Role)}</option>)}</select></Field><Field label="Model"><select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" onChange={(event) => setModel(event.currentTarget.value)} value={model}><option>ChatGPT subscription</option>{localModels.length > 0 ? <optgroup label="Ollama · local">{localModels.map((localModel) => <option key={localModel.id} value={`Ollama · ${localModel.id}`}>{localModel.name}{localModel.details ? ` · ${localModel.details}` : ""}</option>)}</optgroup> : <option disabled>{modelsLoading ? "Scanning for Ollama…" : "Ollama offline"}</option>}<option>Choose after spawning</option></select></Field><Field label="Working context"><Textarea className="min-h-24" onChange={(event) => setContext(event.currentTarget.value)} value={context} /></Field></div><div className="space-y-4"><ChoiceGroup label="Tools" values={["Artifacts", "Task board", "Web search", "File workspace", "Workflow"]} selected={tools} onToggle={(value) => toggle(value, tools, setTools)} /><ChoiceGroup label="Permissions" values={["Read workspace", "Create tasks", "Edit artifacts", "External actions"]} selected={permissions} onToggle={(value) => toggle(value, permissions, setPermissions)} /><div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><div className="flex items-center gap-2 font-medium"><ShieldCheckIcon className="size-4" />Safety defaults are on</div><p className="mt-1 text-amber-800/80">External and irreversible actions will ask for confirmation before running.</p></div></div></div><DialogFooter><Button onClick={onClose} variant="outline">Cancel</Button><Button disabled={name.trim().length === 0} onClick={create}><SparklesIcon /> Spawn agent</Button></DialogFooter></DialogContent></Dialog>;
}

function RoomMembersDialog({ open, onClose, onSave, agents, people, selectedAgentIds, selectedPersonIds }: { readonly open: boolean; readonly onClose: () => void; readonly onSave: (agentIds: string[], personIds: string[], invitedPeople: Person[]) => void; readonly agents: Agent[]; readonly people: Person[]; readonly selectedAgentIds: string[]; readonly selectedPersonIds: string[] }) {
  const [selected, setSelected] = useState<string[]>(["lead", ...selectedAgentIds.filter((id) => id !== "lead")]);
  const [selectedPeople, setSelectedPeople] = useState<string[]>(selectedPersonIds);
  const [pendingPeople, setPendingPeople] = useState<Person[]>([]);
  const [personName, setPersonName] = useState("");
  const [personEmail, setPersonEmail] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelected(["lead", ...selectedAgentIds.filter((id) => id !== "lead")]);
    setSelectedPeople(selectedPersonIds);
    setPendingPeople([]);
    setPersonName("");
    setPersonEmail("");
  }, [open, selectedAgentIds, selectedPersonIds]);

  const toggle = (agentId: string) => {
    if (agentId === "lead") return;
    setSelected((current) => current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId]);
  };

  const togglePerson = (personId: string) => setSelectedPeople((current) => current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId]);

  const addPerson = () => {
    const email = personEmail.trim().toLowerCase();
    if (!email) return;
    const existing = [...people, ...pendingPeople].find((person) => person.email.toLowerCase() === email);
    if (existing) {
      setSelectedPeople((current) => current.includes(existing.id) ? current : [...current, existing.id]);
    } else {
      const person: Person = { id: `person-${Date.now()}`, name: personName.trim() || email.split("@")[0], email };
      setPendingPeople((current) => [...current, person]);
      setSelectedPeople((current) => [...current, person.id]);
    }
    setPersonName("");
    setPersonEmail("");
  };

  const availablePeople = [...people, ...pendingPeople];
  return <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Manage room members</DialogTitle><DialogDescription>Invite agents or people to share this room’s context. Uncheck anyone you want to uninvite.</DialogDescription></DialogHeader><div className="space-y-5"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Agents</p><div className="space-y-2">{agents.map((agent) => { const isLead = agent.id === "lead"; return <label className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5", isLead ? "bg-muted/30" : "cursor-pointer hover:bg-accent")} key={agent.id}><input checked={selected.includes(agent.id)} disabled={isLead} onChange={() => toggle(agent.id)} type="checkbox" /><AgentAvatar agent={agent} small /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{agent.name}</span><span className="block truncate text-xs text-muted-foreground">{agent.description}</span></span><RoleBadge role={agent.role} /></label>; })}</div></div><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">People</p>{availablePeople.length > 0 ? <div className="space-y-2">{availablePeople.map((person) => <label className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-accent" key={person.id}><input checked={selectedPeople.includes(person.id)} onChange={() => togglePerson(person.id)} type="checkbox" /><PersonAvatar person={person} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{person.name}</span><span className="block truncate text-xs text-muted-foreground">{person.email}</span></span><Badge variant="outline">Person</Badge></label>)}</div> : <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">No people have been added yet.</p>}<div className="mt-3 rounded-lg border bg-muted/20 p-3"><p className="text-xs font-medium">Add a person</p><p className="mt-1 text-xs text-muted-foreground">Add their name and email to this local workspace.</p><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><Input aria-label="Person name" onChange={(event) => setPersonName(event.currentTarget.value)} placeholder="Name" value={personName} /><Input aria-label="Person email" onChange={(event) => setPersonEmail(event.currentTarget.value)} placeholder="Email" type="email" value={personEmail} /><Button disabled={personEmail.trim().length === 0} onClick={addPerson} type="button"><PlusIcon />Add</Button></div></div></div></div><DialogFooter><Button onClick={onClose} variant="outline">Cancel</Button><Button onClick={() => onSave(selected, selectedPeople, pendingPeople.filter((person) => selectedPeople.includes(person.id)))}><UsersIcon /> Update members</Button></DialogFooter></DialogContent></Dialog>;
}

function RoomCreatorDialog({ open, onClose, onCreate }: { readonly open: boolean; readonly onClose: () => void; readonly onCreate: (room: Room) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = () => { if (!name.trim()) return; onCreate({ id: `room-${Date.now()}`, name: name.trim(), description: description.trim() || "A shared workshop space for your agents.", agentIds: ["lead"], personIds: [], messages: [] }); setName(""); setDescription(""); };
  return <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}><DialogContent><DialogHeader><DialogTitle>Create workshop room</DialogTitle><DialogDescription>Give a team of agents a shared goal and working context.</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Room name"><Input onChange={(event) => setName(event.currentTarget.value)} placeholder="e.g. Product discovery" value={name} /></Field><Field label="Purpose"><Textarea onChange={(event) => setDescription(event.currentTarget.value)} placeholder="What should this room accomplish?" value={description} /></Field></div><DialogFooter><Button onClick={onClose} variant="outline">Cancel</Button><Button disabled={name.trim().length === 0} onClick={create}><PlusIcon /> Create room</Button></DialogFooter></DialogContent></Dialog>;
}

function TaskCreatorDialog({ open, onClose, onCreate, agents, people, room }: { readonly open: boolean; readonly onClose: () => void; readonly onCreate: (task: Task) => void; readonly agents: Agent[]; readonly people: Person[]; readonly room?: Room }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeType, setAssigneeType] = useState<TaskAssigneeType>("agent");
  const [assigneeId, setAssigneeId] = useState(agents.find((agent) => agent.id !== "lead")?.id ?? agents[0]?.id ?? "");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const assignees = assigneeType === "agent" ? agents : people;
  const chooseAssigneeType = (nextType: TaskAssigneeType) => {
    setAssigneeType(nextType);
    setAssigneeId(nextType === "agent" ? agents[0]?.id ?? "" : people[0]?.id ?? "");
  };
  const create = () => { if (!title.trim() || !assigneeId) return; onCreate({ id: `task-${Date.now()}`, title: title.trim(), description: description.trim() || "Complete the assigned work and report the result.", assigneeId, assigneeType, roomId: room?.id, status: "queued", priority, updated: "Just now", revision: 0 }); setTitle(""); setDescription(""); };
  return <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}><DialogContent><DialogHeader><DialogTitle>Assign a task</DialogTitle><DialogDescription>Give an agent or person a clear outcome and place it in the queue.</DialogDescription></DialogHeader><div className="space-y-4">{room ? <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">Created from <span className="font-medium text-foreground">{room.name}</span>. The room context will be included for the assigned agent.</div> : null}<Field label="Task title"><Input onChange={(event) => setTitle(event.currentTarget.value)} placeholder="e.g. Compare local model options" value={title} /></Field><Field label="Brief / instructions"><Textarea onChange={(event) => setDescription(event.currentTarget.value)} placeholder="What does done look like?" value={description} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Assign to"><div className="mb-2 flex gap-2"><Button className="flex-1" onClick={() => chooseAssigneeType("agent")} size="sm" type="button" variant={assigneeType === "agent" ? "default" : "outline"}><BotIcon /> Agent</Button><Button className="flex-1" onClick={() => chooseAssigneeType("person")} size="sm" type="button" variant={assigneeType === "person" ? "default" : "outline"}><UsersIcon /> Person</Button></div>{assignees.length > 0 ? <select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" onChange={(event) => setAssigneeId(event.currentTarget.value)} value={assigneeId}>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}{"role" in assignee ? ` · ${roleLabel(assignee.role)}` : ` · ${assignee.email}`}</option>)}</select> : <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">No people have been added yet. Add them from Workshop Rooms first.</p>}</Field><Field label="Priority"><select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" onChange={(event) => setPriority(event.currentTarget.value as Task["priority"])} value={priority}>{["low", "medium", "high"].map((value) => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}</select></Field></div></div><DialogFooter><Button onClick={onClose} variant="outline">Cancel</Button><Button disabled={title.trim().length === 0 || !assigneeId} onClick={create}><ClipboardListIcon /> Assign task</Button></DialogFooter></DialogContent></Dialog>;
}

function TaskEditorDialog({ task, agents, people, room, onClose, onSave }: { readonly task?: Task; readonly agents: Agent[]; readonly people: Person[]; readonly room?: Room; readonly onClose: () => void; readonly onSave: (task: Task) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeType, setAssigneeType] = useState<TaskAssigneeType>("agent");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
    setAssigneeType(task.assigneeType);
    setAssigneeId(task.assigneeId);
    setPriority(task.priority);
  }, [task]);
  if (!task) return null;
  const assignees = assigneeType === "agent" ? agents : people;
  const chooseAssigneeType = (nextType: TaskAssigneeType) => {
    setAssigneeType(nextType);
    setAssigneeId(nextType === "agent" ? agents[0]?.id ?? "" : people[0]?.id ?? "");
  };
  const save = () => {
    if (!title.trim() || !assigneeId) return;
    onSave({ ...task, title: title.trim(), description: description.trim() || "Complete the assigned work and report the result.", assigneeId, assigneeType, priority });
  };
  return <Dialog open onOpenChange={(nextOpen) => !nextOpen && onClose()}><DialogContent><DialogHeader><DialogTitle>Edit task</DialogTitle><DialogDescription>Update the instructions or reassignment. Agent tasks will run again with the new instructions.</DialogDescription></DialogHeader><div className="space-y-4">{room ? <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">Room context: <span className="font-medium text-foreground">{room.name}</span></div> : null}<Field label="Task title"><Input onChange={(event) => setTitle(event.currentTarget.value)} value={title} /></Field><Field label="Instructions"><Textarea className="min-h-28" onChange={(event) => setDescription(event.currentTarget.value)} value={description} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Assign to"><div className="mb-2 flex gap-2"><Button className="flex-1" onClick={() => chooseAssigneeType("agent")} size="sm" type="button" variant={assigneeType === "agent" ? "default" : "outline"}><BotIcon /> Agent</Button><Button className="flex-1" onClick={() => chooseAssigneeType("person")} size="sm" type="button" variant={assigneeType === "person" ? "default" : "outline"}><UsersIcon /> Person</Button></div>{assignees.length > 0 ? <select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" onChange={(event) => setAssigneeId(event.currentTarget.value)} value={assigneeId}>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}{"role" in assignee ? ` · ${roleLabel(assignee.role)}` : ` · ${assignee.email}`}</option>)}</select> : <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">No people have been added yet. Add them from Workshop Rooms first.</p>}</Field><Field label="Priority"><select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" onChange={(event) => setPriority(event.currentTarget.value as Task["priority"])} value={priority}>{["low", "medium", "high"].map((value) => <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>)}</select></Field></div></div><DialogFooter><Button onClick={onClose} variant="outline">Cancel</Button><Button disabled={!title.trim() || !assigneeId} onClick={save}><CheckCircle2Icon /> Save changes</Button></DialogFooter></DialogContent></Dialog>;
}

function ChoiceGroup({ label, values, selected, onToggle }: { readonly label: string; readonly values: string[]; readonly selected: string[]; readonly onToggle: (value: string) => void }) { return <div><p className="mb-2 text-xs font-medium">{label}</p><div className="grid gap-2">{values.map((value) => <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-accent" key={value}><input checked={selected.includes(value)} onChange={() => onToggle(value)} type="checkbox" />{value}</label>)}</div></div>; }
function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) { return <label className="block space-y-1.5"><span className="text-xs font-medium">{label}</span>{children}</label>; }
function PageIntro({ eyebrow, title, description, action }: { readonly eyebrow: string; readonly title: string; readonly description: string; readonly action?: React.ReactNode }) { return <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p><h1 className="text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p></div>{action ? <div className="shrink-0">{action}</div> : null}</div>; }
function MetricCard({ icon: Icon, label, value, detail, tone }: { readonly icon: LucideIcon; readonly label: string; readonly value: string; readonly detail: string; readonly tone: "violet" | "blue" | "amber" | "emerald" }) { const styles = { violet: "bg-violet-50 text-violet-600", blue: "bg-blue-50 text-blue-600", amber: "bg-amber-50 text-amber-600", emerald: "bg-emerald-50 text-emerald-600" }; return <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div className={cn("flex size-9 items-center justify-center rounded-lg", styles[tone])}><Icon className="size-4" /></div><MoreHorizontalIcon className="size-4 text-muted-foreground" /></div><p className="mt-4 text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>; }
function QuickAction({ icon: Icon, label, detail, onClick }: { readonly icon: LucideIcon; readonly label: string; readonly detail: string; readonly onClick: () => void }) { return <button className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-accent" onClick={onClick} type="button"><div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-4 text-muted-foreground" /></div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{label}</p><p className="mt-0.5 text-xs text-muted-foreground">{detail}</p></div><ChevronRightIcon className="size-4 text-muted-foreground" /></button>; }
function AgentAvatar({ agent, small = false }: { readonly agent?: Agent; readonly small?: boolean }) { return <div className={cn("flex shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-900 font-semibold text-white", small ? "size-7 text-[10px]" : "size-10 text-xs", avatarColor(agent?.role))}>{initials(agent?.name ?? "Agent")}</div>; }
function PersonAvatar({ person }: { readonly person: Person }) { return <div aria-label={person.name} className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-white bg-indigo-600 text-[10px] font-semibold text-white" title={person.name}>{initials(person.name)}</div>; }
function RoomMessageItem({ message }: { readonly message: RoomMessage }) { return <div className="flex gap-3"><AgentAvatar agent={message.role ? { id: message.role, name: message.author, role: message.role, description: "", capabilities: [], model: "", tools: [], permissions: [], status: "idle" } : undefined} small /><div className="min-w-0 max-w-2xl"><div className="flex items-baseline gap-2"><p className="text-xs font-semibold">{message.author}</p>{message.role ? <RoleBadge role={message.role} /> : null}<span className="text-[10px] text-muted-foreground">{message.time}</span></div><div className="mt-1 rounded-lg rounded-tl-none border bg-white px-3 py-2.5 text-sm leading-6 shadow-xs">{renderMentionedContent(message.content)}</div></div></div>; }
function renderMentionedContent(content: string): ReactNode[] { return content.split(/(@[a-z0-9][a-z0-9-]*)/giu).map((part, index) => part.startsWith("@") ? <span className="font-medium text-primary" key={`${part}-${index}`}>{part}</span> : part); }
function RoleBadge({ role }: { readonly role: Role }) { return <Badge className="text-[10px]" variant={role === "lead" ? "default" : "outline"}>{roleLabel(role)}</Badge>; }
function StatusBadge({ status }: { readonly status: TaskStatus }) { return <Badge className={cn("capitalize", status === "active" && "border-violet-200 bg-violet-50 text-violet-700", status === "blocked" && "border-amber-200 bg-amber-50 text-amber-700", status === "completed" && "border-emerald-200 bg-emerald-50 text-emerald-700")} variant="outline">{status}</Badge>; }
function PriorityBadge({ priority }: { readonly priority: Task["priority"] }) { return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", priority === "high" ? "bg-red-50 text-red-600" : priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-muted text-muted-foreground")}>{priority}</span>; }
function ArtifactIcon({ type }: { readonly type: ArtifactType }) { return <span className="flex size-5 items-center justify-center text-muted-foreground">{type === "plan" ? <ClipboardListIcon className="size-4" /> : type === "draft" ? <SquarePenIcon className="size-4" /> : type === "file" ? <FileTextIcon className="size-4" /> : <FileTextIcon className="size-4" />}</span>; }
function EmptyState({ icon: Icon, title, detail, compact = false }: { readonly icon: LucideIcon; readonly title: string; readonly detail: string; readonly compact?: boolean }) { return <div className={cn("flex flex-col items-center justify-center text-center", compact ? "min-h-36" : "min-h-64")}><div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted"><Icon className="size-5 text-muted-foreground" /></div><p className="text-sm font-medium">{title}</p><p className="mt-1 max-w-xs text-xs text-muted-foreground">{detail}</p></div>; }
function sectionTitle(section: Section) { return navItems.find((item) => item.id === section)?.label ?? "Overview"; }
function memberCount(room: Room) { return room.agentIds.length + (room.personIds?.length ?? 0); }
function artifactUpdatedLabel(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
function roleLabel(role: Role) { return role === "custom" ? "Custom role" : role.charAt(0).toUpperCase() + role.slice(1); }
function statusLabel(status: AgentStatus) { return status === "working" ? "Working" : status === "paused" ? "Paused" : status === "blocked" ? "Blocked" : "Ready"; }
function statusDot(status: AgentStatus) { return status === "working" ? "bg-emerald-500" : status === "blocked" ? "bg-amber-500" : status === "paused" ? "bg-slate-400" : "bg-blue-400"; }
function taskTone(status: TaskStatus) { return status === "active" ? "text-violet-600" : status === "blocked" ? "text-amber-600" : status === "completed" ? "text-emerald-600" : "text-muted-foreground"; }
function avatarColor(role?: Role) { return role === "researcher" ? "bg-blue-600" : role === "planner" ? "bg-violet-600" : role === "writer" ? "bg-rose-600" : role === "reviewer" ? "bg-amber-600" : role === "lead" ? "bg-slate-900" : "bg-emerald-600"; }
function initials(name: string) { return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function activityLabel(kind: ActivityItem["kind"]) { return kind === "decision" ? "Decisions" : kind === "tool" ? "Tools" : kind === "progress" ? "Progress" : kind === "failure" ? "Failures" : "Safety"; }
function activityIcon(kind: ActivityItem["kind"]) { return kind === "decision" ? SparklesIcon : kind === "tool" ? WrenchIcon : kind === "progress" ? ActivityIcon : kind === "failure" ? CircleAlertIcon : ShieldCheckIcon; }
function activityTone(kind: ActivityItem["kind"]) { return kind === "decision" ? "bg-violet-50 text-violet-600" : kind === "tool" ? "bg-blue-50 text-blue-600" : kind === "progress" ? "bg-emerald-50 text-emerald-600" : kind === "failure" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"; }
function normalizeStoredTask(task: Partial<Task> & { agentId?: string }): Task {
  return {
    id: task.id ?? `task-${Date.now()}`,
    title: task.title ?? "Untitled task",
    description: task.description ?? "Complete the assigned work and report the result.",
    assigneeId: task.assigneeId ?? task.agentId ?? "lead",
    assigneeType: task.assigneeType === "person" ? "person" : "agent",
    ...(task.roomId ? { roomId: task.roomId } : {}),
    ...(task.result ? { result: task.result } : {}),
    ...(task.revision !== undefined ? { revision: task.revision } : {}),
    ...(task.sourceKey ? { sourceKey: task.sourceKey } : {}),
    status: task.status ?? "queued",
    priority: task.priority ?? "medium",
    updated: task.updated ?? "Just now",
  };
}
function isVaultStatePayload(value: unknown): value is VaultStatePayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<VaultStatePayload>;
  return [candidate.agents, candidate.people, candidate.rooms, candidate.tasks, candidate.activity].every(Array.isArray);
}
function taskAssigneeName(task: Task, agents: Agent[], people: Person[]): string {
  return task.assigneeType === "person"
    ? people.find((person) => person.id === task.assigneeId)?.name ?? "Unassigned person"
    : agents.find((agent) => agent.id === task.assigneeId)?.name ?? "Unassigned agent";
}

function parseTasksFromMessage(message: RoomMessage, room: Room, agents: Agent[], people: Person[]): ParsedTask[] {
  if (!/(?:task|owner|P[0-3]|smallest testable)/iu.test(message.content)) return [];
  const targets = buildMentionTargets(agents, people);
  const defaultAgent = agents.find((agent) => agent.name.toLowerCase() === message.author.toLowerCase());
  return parseTaskSections(message.content).map((section, index) => {
    const ownerHandle = section.ownerHandle ?? section.body.match(/\bOwner[*\s]*:\s*@?([a-z0-9_-]+)/iu)?.[1];
    const owner = targets.find((target) => target.handle.toLowerCase() === ownerHandle?.toLowerCase());
    const fallback = defaultAgent ?? agents[0] ?? people[0];
    const priority = taskPriority(`${section.title}\n${section.sourceLine}\n${section.body}`);
    return {
      title: section.title,
      description: cleanTaskText([section.body, section.body.length === 0 ? "Complete the assigned work and report the result." : ""].join("\n")).slice(0, 1600),
      assigneeId: owner?.id ?? fallback?.id ?? "you",
      assigneeType: owner?.kind ?? (defaultAgent ? "agent" : "person"),
      priority,
      sourceKey: `${room.id}:${message.id}:${index}:${slugify(section.title)}`,
    };
  });
}

function parseTaskSections(content: string): Array<{ title: string; body: string; sourceLine: string; ownerHandle?: string }> {
  const lines = content.split(/\r?\n/u);
  const starts: Array<{ index: number; title: string; bodyPrefix: string; ownerHandle?: string }> = [];
  lines.forEach((line, index) => {
    const numbered = line.match(/^\s*(?:[-*]\s+)?\d+[.)]\s+\*\*(.+?)\*\*(?:\s*[—-]\s*(P[0-3]|High|Medium|Low))?\s*$/iu);
    if (numbered) {
      starts.push({ index, title: cleanTaskText(numbered[1]), bodyPrefix: numbered[2] ? `Priority: ${numbered[2]}` : "" });
      return;
    }
    const heading = line.match(/^\s*#{2,4}\s*(?:\d+[.)]\s*)?(?:\*\*)?(.+?)(?:\*\*)?\s*$/u);
    if (heading) {
      const title = cleanTaskText(heading[1]);
      if (!isTaskSectionHeading(title)) starts.push({ index, title, bodyPrefix: "" });
      return;
    }
    const bullet = line.match(/^\s*[-*]\s+\*\*(.+?):\*\*\s+(.+?)\s*$/u);
    if (bullet && /(?:task|priority|progress|lead|mvp|draft|review|define|build|validate|prototype|onboarding|workflow|criteria|scope)/iu.test(`${bullet[1]} ${bullet[2]}`)) {
      const action = bullet[2].replace(/^@([a-z0-9_-]+)\s*/iu, "").trim();
      const ownerHandle = bullet[2].match(/^@([a-z0-9_-]+)/iu)?.[1];
      starts.push({ index, title: cleanTaskText(`${bullet[1]}: ${action}`), bodyPrefix: action, ownerHandle });
    }
  });
  return starts.map((start, index) => {
    const nextIndex = starts[index + 1]?.index ?? lines.length;
    const body = [start.bodyPrefix, ...lines.slice(start.index + 1, nextIndex)].filter(Boolean).join("\n").trim();
    return { title: start.title, body: cleanTaskText(body), sourceLine: lines[start.index] ?? "", ownerHandle: start.ownerHandle };
  }).filter((section) => section.title.length > 3 && section.title.length < 180);
}

function isTaskSectionHeading(title: string): boolean {
  return /^(?:milestone|conversation|scope|evidence|smallest testable deliverable|acceptance criteria|risk|key risks?|finding|open question|prioritized next actions?|next actions?|assumptions?|definition of done|dependency|initial priorities|focused proposal)$/iu.test(title.trim()) || /^(?:milestone|prioritized next actions?|next actions?\b)/iu.test(title.trim());
}

function taskPriority(value: string): Task["priority"] {
  if (/\b(?:P0|P1|High)\b/iu.test(value)) return "high";
  if (/\b(?:P3|Low)\b/iu.test(value)) return "low";
  return "medium";
}

function cleanTaskText(value: string): string {
  return value.replace(/[*`#]/gu, "").replace(/\s+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 60) || "task";
}
