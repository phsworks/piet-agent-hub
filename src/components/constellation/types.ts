import { createElement, type CSSProperties } from "react";
import {
  Bot,
  Brain,
  CircleDot,
  Briefcase,
  Clock,
  FolderKanban,
  GraduationCap,
  Lightbulb,
  ListChecks,
  NotebookPen,
  Rocket,
  type LucideIcon,
} from "lucide-react";

export type AgentNode = {
  id: string;
  slug: string;
  parentId: string | null;
  name: string;
  branch: string;
  description: string;
  systemPrompt: string;
  icon: string;
  position: number;
  kind: "agent" | "project";
};

// Canvas can't read CSS variables cheaply, so branch colors live here.
export const BRANCH_COLORS: Record<string, string> = {
  general: "#c084fc",
  school: "#818cf8",
  work: "#2dd4bf",
  projects: "#f472b6",
};

export function branchColor(branch: string) {
  return BRANCH_COLORS[branch] ?? BRANCH_COLORS.general;
}

const ICONS: Record<string, LucideIcon> = {
  brain: Brain,
  "circle-dot": CircleDot,
  clock: Clock,
  "graduation-cap": GraduationCap,
  "folder-kanban": FolderKanban,
  lightbulb: Lightbulb,
  briefcase: Briefcase,
  "list-checks": ListChecks,
  "notebook-pen": NotebookPen,
  rocket: Rocket,
};

export function AgentIcon({
  name,
  className,
  style,
}: {
  name: string;
  className?: string;
  style?: CSSProperties;
}) {
  return createElement(ICONS[name] ?? Bot, { className, style });
}
