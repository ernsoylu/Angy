import { env } from "./env.js";
import { buildServer } from "./server.js";

const server = buildServer(env.port);

void server.listen().then(() => {
  console.log(`[realtime] hocuspocus listening on :${env.port}`);
});
