export async function register() {
  // Background jobs only run in the Node.js server, not in edge/browser bundles.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWorker } = await import("@/lib/files/worker");
  startWorker().catch((err) => console.error("File worker failed to start", err));
  // Once the hub runs on the VPS, a dev server on the Mac must not answer
  // Telegram or send check-ins too: BACKGROUND_JOBS=off in .env.local.
  if (process.env.BACKGROUND_JOBS === "off") {
    console.log("Background jobs and the Telegram bot are off (BACKGROUND_JOBS=off)");
    return;
  }
  const { startJobs } = await import("@/lib/jobs/scheduler");
  startJobs().catch((err) => console.error("Scheduled jobs failed to start", err));
  const { startBot } = await import("@/lib/telegram/bot");
  startBot();
}
