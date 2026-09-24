import { agents, files } from "@/lib/db/schema";

// Columns the UI gets for a file (never temp paths or hashes).
export const FILE_COLUMNS = {
  id: files.id,
  name: files.name,
  path: files.path,
  kind: files.kind,
  section: files.section,
  agentId: files.agentId,
  agentName: agents.name,
  status: files.status,
  error: files.error,
  summary: files.summary,
  size: files.size,
  driveUrl: files.driveUrl,
  createdAt: files.createdAt,
  processedAt: files.processedAt,
};
