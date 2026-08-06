import { z } from "zod";

/** Canonical API error shape: { success: false, error: { code, message, details? } } */
export const apiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export interface ApiOk<T> {
  success: true;
  data: T;
}

export type ApiResponse<T> = ApiOk<T> | ApiError;

export function ok<T>(data: T): ApiOk<T> {
  return { success: true, data };
}

export function apiError(code: string, message: string, details?: unknown): ApiError {
  return { success: false, error: { code, message, ...(details !== undefined && { details }) } };
}
