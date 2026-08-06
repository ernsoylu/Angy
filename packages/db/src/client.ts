import { PrismaClient } from "@prisma/client";

let instance: PrismaClient | undefined;

/** Process-wide Prisma client. All DB access across apps goes through @angy/db. */
export function getPrisma(): PrismaClient {
  instance ??= new PrismaClient();
  return instance;
}
