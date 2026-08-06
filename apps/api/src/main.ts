import "reflect-metadata";
import { env } from "./env";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: env.webOrigin, credentials: true });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(env.port);
  console.log(`[api] listening on :${env.port}`);
}

void bootstrap();
