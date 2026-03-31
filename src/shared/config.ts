import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

export type EventFilter =
  | true
  | { conclusion?: string[]; mention?: string };

export interface Config {
  token: string;
  pollInterval: number;
  events: Record<string, EventFilter>;
  trustedUsers: string[];
  trustedBots: string[];
  debug: boolean;
}

export const CONFIG_PATH = path.join(os.homedir(), ".config", "github-webhook-channel.json");

const DEFAULT_EVENTS: Record<string, EventFilter> = {
  pull_request_review: true,
  check_run: { conclusion: ["failure"] },
  issue_comment: true,
};

export function loadConfig(file = CONFIG_PATH): Config {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    // config file is optional
  }

  let token = (process.env.GITHUB_TOKEN as string) ?? (process.env.GH_TOKEN as string) ?? (raw.token as string) ?? "";
  if (!token) {
    try {
      token = execSync("gh auth token", { encoding: "utf-8", stdio: "pipe" }).trim();
    } catch {
      // gh CLI not available or not authenticated
    }
  }
  const pollInterval = (raw.pollInterval as number) ?? 30000;
  const events = (raw.events as Record<string, EventFilter>) ?? DEFAULT_EVENTS;

  const trustedUsers = (raw.trustedUsers as string[]) ?? [];
  const trustedBots = (raw.trustedBots as string[]) ?? [];
  const debug = (process.env.GH_WEBHOOK_DEBUG === "true") || (raw.debug as boolean) === true;

  return { token, pollInterval, events, trustedUsers, trustedBots, debug };
}
