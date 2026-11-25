import { defaultGmailOAuthHandler } from "../../../backend/api/gmail_oauth.ts";

Deno.serve(defaultGmailOAuthHandler());
