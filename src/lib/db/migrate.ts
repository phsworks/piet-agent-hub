import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });

  await sql.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
