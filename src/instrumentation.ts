export async function register() {
  // Background jobs only run in the Node.js server, not in edge/browser bundles.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startWorker } = await import("@/lib/files/worker");
  startWorker().catch((err) => console.error("File worker failed to start", err));
  const { startJobs } = await import("@/lib/jobs/scheduler");
  startJobs().catch((err) => console.error("Scheduled jobs failed to start", err));
}
