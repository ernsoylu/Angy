import { Controller, Get } from "@nestjs/common";
import { ok, type ApiOk, type Health } from "@angy/shared";

@Controller("health")
export class HealthController {
  @Get()
  health(): ApiOk<Health> {
    return ok({ status: "ok", service: "api", time: new Date().toISOString() });
  }
}
