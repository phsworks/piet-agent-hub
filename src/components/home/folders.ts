/** A folder in the file tree (rows of the agents table), as /api/agents returns it. */
export type FolderNode = {
  id: string;
  slug: string;
  parentId: string | null;
  name: string;
  branch: string;
  position: number;
};

const BRANCH_COLORS: Record<string, string> = {
  general: "#c084fc",
  school: "#818cf8",
  work: "#2dd4bf",
  projects: "#f472b6",
};

export function branchColor(branch: string) {
  return BRANCH_COLORS[branch] ?? BRANCH_COLORS.general;
}
