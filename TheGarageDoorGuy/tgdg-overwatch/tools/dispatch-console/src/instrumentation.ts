// Runs once when the server starts. Starts the automatic refresh (on a server that stays running).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAutoSync } = await import("@/lib/auto-sync");
    startAutoSync();
  }
}
