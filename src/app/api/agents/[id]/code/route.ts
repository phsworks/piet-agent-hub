import { NextRequest } from "next/server";
import { unzipSync } from "fflate";
import { getAgentById } from "@/lib/agents/registry";
import { enqueueCodeSnapshot } from "@/lib/files/ingest";
import { filterCodeEntries, redactSecrets, stripCommonRoot } from "@/lib/files/code-filter";
import { extensionOf } from "@/lib/files/file-types";

export const dynamic = "force-dynamic";

type Entry = { path: string; size: number; data: Uint8Array };

// multipart/form-data: either many "file" parts named by their relative path
// (folder picker), or a single .zip. Filtering runs again here so secrets never
// get in, whatever the client sent.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/agents/[id]/code">) {
  const { id } = await ctx.params;
  const agent = await getAgentById(id);
  if (!agent || agent.kind !== "project") return new Response("Not found", { status: 404 });

  const form = await req.formData();
  const parts = form.getAll("file").filter((f): f is File => f instanceof File);
  const paths = form.getAll("path").map(String);

  let entries: Entry[] = [];
  if (parts.length === 1 && extensionOf(parts[0].name) === "zip") {
    const unzipped = unzipSync(new Uint8Array(await parts[0].arrayBuffer()), {
      filter: (f) => !f.name.endsWith("/"),
    });
    entries = Object.entries(unzipped).map(([path, data]) => ({ path, size: data.length, data }));
  } else {
    for (const [i, part] of parts.entries()) {
      entries.push({
        path: paths[i] || part.name,
        size: part.size,
        data: new Uint8Array(await part.arrayBuffer()),
      });
    }
  }

  const { root, entries: relative } = stripCommonRoot(entries);
  const gitignore = relative.find((e) => e.path === ".gitignore");
  const { kept, skipped, truncated } = filterCodeEntries(
    relative,
    gitignore ? new TextDecoder().decode(gitignore.data) : undefined
  );
  if (kept.length === 0) return new Response("No code files found after filtering.", { status: 400 });

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const fileId = await enqueueCodeSnapshot({
    agentId: agent.id,
    snapshot: {
      root: root ?? (parts.length === 1 ? parts[0].name.replace(/\.zip$/i, "") : null),
      entries: kept.map((e) => ({ path: e.path, content: redactSecrets(decoder.decode(e.data)) })),
    },
  });
  return Response.json({ fileId, files: kept.length, skipped, truncated });
}
