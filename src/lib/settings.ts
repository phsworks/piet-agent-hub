import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value as T | undefined;
}

export async function setSetting<T>(key: string, value: T) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function deleteSetting(key: string) {
  await db.delete(settings).where(eq(settings.key, key));
}
