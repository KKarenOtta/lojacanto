import { defaultNotificationHandler } from "../../../backend/api/ml_notifications.ts";

Deno.serve(defaultNotificationHandler());
