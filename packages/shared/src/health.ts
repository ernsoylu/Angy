import { z } from "zod";

export const serviceNameSchema = z.enum(["web", "api", "realtime", "worker"]);
export type ServiceName = z.infer<typeof serviceNameSchema>;

export const healthSchema = z.object({
  status: z.literal("ok"),
  service: serviceNameSchema,
  time: z.iso.datetime(),
});

export type Health = z.infer<typeof healthSchema>;
