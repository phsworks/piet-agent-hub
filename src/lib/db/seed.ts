import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { agents } from "./schema";
import { SEED_AGENTS } from "../agents/seed-data";

config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(sql);

  // Parents come before children in SEED_AGENTS, so slugs resolve in order.
  const idsBySlug = new Map<string, string>();
  const positionByParent = new Map<string | null, number>();

  for (const a of SEED_AGENTS) {
    const parentId = a.parentSlug ? idsBySlug.get(a.parentSlug) : null;
    if (parentId === undefined) {
      throw new Error(`Parent "${a.parentSlug}" of "${a.slug}" not seeded yet`);
    }
    const position = positionByParent.get(a.parentSlug) ?? 0;
    positionByParent.set(a.parentSlug, position + 1);

    const values = {
      parentId,
      name: a.name,
      branch: a.branch,
      description: a.description,
      systemPrompt: a.systemPrompt,
      allowedTools: a.allowedTools,
      icon: a.icon,
      position,
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(agents)
      .values({ slug: a.slug, ...values })
      // Existing agents keep their place, name, description and instructions,
      // since Piet edits those in the app; only the tool list follows this file.
      .onConflictDoUpdate({
        target: agents.slug,
        set: { allowedTools: values.allowedTools, updatedAt: values.updatedAt },
      })
      .returning({ id: agents.id });
    idsBySlug.set(a.slug, row.id);
  }

  // Attach Phase 1 conversations (which predate agents) to the Brain.
  const brainId = idsBySlug.get("brain")!;
  await sql`UPDATE conversations SET agent_id = ${brainId} WHERE agent_id IS NULL`;

  const all = await db.select({ slug: agents.slug }).from(agents);
  const stale = all.filter((r) => !idsBySlug.has(r.slug));
  for (const r of stale) {
    console.warn(`Agent "${r.slug}" is in the DB but not in seed data (left untouched).`);
  }

  await sql.end();
  console.log(`Seeded ${SEED_AGENTS.length} agents.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
