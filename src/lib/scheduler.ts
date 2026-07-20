import { logger } from "./logger";

interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
  /** Exécuter immédiatement à l'enregistrement (en plus de l'intervalle). */
  runOnStart?: boolean;
}

const timers = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();

/**
 * Enregistre un job périodique. Chaque tick est isolé (les erreurs sont
 * loggées, jamais propagées) et un tick ne démarre pas si le précédent
 * tourne encore.
 */
export function registerJob(job: Job): void {
  if (timers.has(job.name)) return;

  const tick = async () => {
    if (running.has(job.name)) return;
    running.add(job.name);
    try {
      await job.run();
    } catch (err) {
      logger.error({ err, job: job.name }, "Erreur dans le job périodique");
    } finally {
      running.delete(job.name);
    }
  };

  timers.set(job.name, setInterval(tick, job.intervalMs));
  logger.info({ job: job.name, intervalMs: job.intervalMs }, "Job enregistré");
  if (job.runOnStart) void tick();
}

export function stopAllJobs(): void {
  for (const [name, timer] of timers) {
    clearInterval(timer);
    timers.delete(name);
  }
}
