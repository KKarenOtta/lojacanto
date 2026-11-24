import { defaultHealthHandler } from "../../../backend/api/health.ts";

Deno.serve(defaultHealthHandler());
