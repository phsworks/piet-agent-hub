export async function register() {
  // Background jobs only run in the Node.js server, not in edge/browser bundles.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWorker } = await import("@/lib/files/worker");
  startWorker().catch((err) => console.error("File worker failed to start", err));
  // Only one process may poll the Telegram bot and send check-ins, or Piet
  // gets everything twice. That's the VPS: docker-compose.prod.yml sets
  // BACKGROUND_JOBS=on. Anywhere else (npm run dev on the Mac) they stay off.
  if (process.env.BACKGROUND_JOBS !== "on") {
    console.log("Background jobs and the Telegram bot are off (set BACKGROUND_JOBS=on to run them)");
    return;
  }
  const { startJobs } = await import("@/lib/jobs/scheduler");
  startJobs().catch((err) => console.error("Scheduled jobs failed to start", err));
  const { startBot } = await import("@/lib/telegram/bot");
  startBot();
}
