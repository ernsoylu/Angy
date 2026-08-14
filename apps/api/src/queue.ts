import { Queue } from "bullmq";
import { QUEUE_MAINTENANCE, QUEUE_PROJECTIONS, type ProjectionJobData } from "@angy/shared";
import { getRedis } from "./redis";

let projections: Queue<ProjectionJobData> | undefined;
let maintenance: Queue | undefined;

export function projectionsQueue(): Queue<ProjectionJobData> {
  projections ??= new Queue(QUEUE_PROJECTIONS, { connection: getRedis() });
  return projections;
}

/** Thumbnails and attachment re-indexing — anything an upload leaves behind. */
export function maintenanceQueue(): Queue {
  maintenance ??= new Queue(QUEUE_MAINTENANCE, { connection: getRedis() });
  return maintenance;
}
