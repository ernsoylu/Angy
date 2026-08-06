import { Queue } from "bullmq";
import { QUEUE_PROJECTIONS, type ProjectionJobData } from "@angy/shared";
import { getRedis } from "./redis";

let projections: Queue<ProjectionJobData> | undefined;

export function projectionsQueue(): Queue<ProjectionJobData> {
  projections ??= new Queue(QUEUE_PROJECTIONS, { connection: getRedis() });
  return projections;
}
