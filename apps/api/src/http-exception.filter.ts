import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { apiError } from "@angy/shared";

const CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
};

/** Maps every error to the canonical shape: { success: false, error: { code, message } }. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const details =
        typeof body === "object" && body !== null && "details" in body
          ? (body as { details: unknown }).details
          : undefined;
      res
        .status(status)
        .json(apiError(CODES[status] ?? "ERROR", exception.message, details));
      return;
    }
    console.error(exception);
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(apiError("INTERNAL", "Something went wrong"));
  }
}
