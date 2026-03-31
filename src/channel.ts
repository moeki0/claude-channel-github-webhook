#!/usr/bin/env npx tsx

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildNotification } from "./shared/message";
import { loadConfig } from "./shared/config";
import { fetchEvents, filterEvents, filterByPr, findPrForBranch, fetchFailedJobLogs, fetchPrComments, fetchCheckRuns } from "./shared/github";
import { detectRepo, getCurrentBranch, checkConflictWithBase } from "./shared/git";
import { MuteManager } from "./shared/mute";

const config = loadConfig();
const { token, pollInterval, events, trustedUsers, debug } = config;

function log(msg: string) {
  process.stderr.write(`[github-webhook] ${msg}\n`);
}
function debugLog(msg: string) {
  if (debug) log(`[debug] ${msg}`);
}

const repoInfo = detectRepo();
if (!repoInfo) {
  log("Not a git repository or no origin remote");
  process.exit(1);
}
const { owner, repo } = repoInfo;

// owner は自動的に信頼
if (!trustedUsers.includes(owner)) {
  trustedUsers.push(owner);
}

log(`Detected ${owner}/${repo}`);
debugLog(`Trusted users: ${trustedUsers.join(", ")}`);

const muteManager = new MuteManager();

const mcp = new Server(
  { name: "github-webhook", version: "2.1.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: [
      "Events from the github-webhook channel arrive as <channel source=\"github-webhook\" ...>.",
      "These are ambient background notifications — do not interrupt your current task.",
      "All notifications come from trusted team members (external authors are blocked).",
      "On check_run failures: read the CI logs and attempt to fix the issue.",
      "On pull_request_review: read the review comments and address the feedback.",
      "On conflict: resolve the merge conflict with the base branch.",
      "Use the mute-gh tool to temporarily pause notifications when focusing.",
    ].join(" "),
  }
);

// MCP Tools
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "mute-gh",
      description: "Mute GitHub notifications. Pass minutes for timed mute, omit for indefinite.",
      inputSchema: {
        type: "object" as const,
        properties: {
          minutes: { type: "number", description: "Minutes to mute (omit for indefinite)" },
        },
      },
    },
    {
      name: "unmute-gh",
      description: "Resume GitHub notifications.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "mute-gh-status",
      description: "Check current mute status.",
      inputSchema: { type: "object" as const, properties: {} },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "mute-gh": {
      const minutes = (args as { minutes?: number }).minutes;
      if (minutes != null && minutes > 0) {
        muteManager.muteFor(minutes * 60 * 1000);
        return { content: [{ type: "text" as const, text: `Muted for ${minutes} minutes.` }] };
      }
      muteManager.muteAll();
      return { content: [{ type: "text" as const, text: "Muted indefinitely. Use unmute-gh to resume." }] };
    }
    case "unmute-gh":
      muteManager.unmute();
      return { content: [{ type: "text" as const, text: "Notifications resumed." }] };
    case "mute-gh-status":
      return { content: [{ type: "text" as const, text: `Status: ${muteManager.status()}` }] };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

await mcp.connect(new StdioServerTransport());

type NotificationParams = { [key: string]: unknown; content: string; meta: Record<string, string> };

async function notify(params: NotificationParams) {
  if (muteManager.isMuted()) {
    debugLog(`muted, skipping: ${params.meta.event}`);
    return;
  }

  // Trust tier: block external authors, skip bots
  if (params.meta.author) {
    if (trustedUsers.length > 0) {
      if (!trustedUsers.includes(params.meta.author)) {
        debugLog(`blocked (not trusted): ${params.meta.author}`);
        return;
      }
      params.meta.trust = params.meta.author.endsWith("[bot]") ? "bot" : "team";
    } else if (params.meta.author.endsWith("[bot]")) {
      debugLog(`skipping bot: ${params.meta.author}`);
      return;
    }
  }

  await mcp.notification({
    method: "notifications/claude/channel",
    params,
  });
  log(`notified: ${params.meta.event}${params.meta.author ? ` by ${params.meta.author} (${params.meta.trust ?? "unset"})` : ""}`);
}

let since = new Date().toISOString();
let commentSince = new Date().toISOString();
const seenIds = new Set<string>();
const seenCommentIds = new Set<number>();
const seenCheckRunConclusions = new Map<number, string | null>();
let currentPrNumber: number | null = null;
let currentBranch: string | null = null;
let lastConflictState = false;


async function checkForPr(): Promise<boolean> {
  const branch = getCurrentBranch();
  debugLog(`current branch: ${branch}`);

  if (!branch || branch === "main" || branch === "master") {
    if (currentPrNumber) {
      log("No PR branch, idling");
      currentPrNumber = null;
    }
    return false;
  }

  const pr = await findPrForBranch(owner, repo, branch, token);
  if (pr) {
    if (pr.number !== currentPrNumber) {
      currentPrNumber = pr.number;
      currentBranch = branch;
      seenCheckRunConclusions.clear();
      log(`Watching PR #${pr.number}: ${pr.title}`);
    }
    return true;
  }

  debugLog(`No open PR for branch ${branch}`);
  if (currentPrNumber) {
    log("PR closed or not found, idling");
    currentPrNumber = null;
  }
  return false;
}

async function poll() {
  try {
    const hasPr = await checkForPr();

    if (hasPr) {
      // Events API
      debugLog("fetching events...");
      const allEvents = await fetchEvents(owner, repo, token, since);
      const prFiltered = currentPrNumber ? filterByPr(allEvents, currentPrNumber) : allEvents;
      const filtered = filterEvents(prFiltered, events);
      debugLog(`events: ${allEvents.length} total, ${prFiltered.length} for PR, ${filtered.length} after filter`);

      for (const item of filtered) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);

        if (item.event === "check_run") {
          const checkRun = item.payload.check_run as { conclusion?: string; html_url?: string } | undefined;
          const htmlUrl = checkRun?.html_url;
          const runIdMatch = htmlUrl?.match(/\/runs\/(\d+)/);
          if (checkRun?.conclusion === "failure" && runIdMatch) {
            debugLog(`fetching CI logs for run ${runIdMatch[1]}...`);
            try {
              const logs = await fetchFailedJobLogs(owner, repo, parseInt(runIdMatch[1]), token);
              item.payload._failedLogs = logs;
            } catch {
              // best-effort
            }
          }
        }

        const notification = buildNotification(item.event, item.payload, config.events);
        if (notification) {
          await notify(notification);
        }
      }

      if (allEvents.length > 0) {
        since = allEvents[0].created_at;
      }

      // PR コメント
      if (currentPrNumber) {
        debugLog("fetching PR comments...");
        const comments = await fetchPrComments(owner, repo, currentPrNumber, commentSince, token);
        debugLog(`comments: ${comments.length} new`);

        for (const c of comments) {
          if (seenCommentIds.has(c.id)) continue;
          seenCommentIds.add(c.id);

          const content = c.type === "review_comment"
            ? [`Review comment by ${c.author} on ${c.path}:${c.line}`, c.diff_hunk ? `\`\`\`diff\n${c.diff_hunk}\n\`\`\`` : "", c.body, c.html_url].filter(Boolean).join("\n")
            : [`Comment by ${c.author}`, c.body, c.html_url].join("\n");

          const meta: Record<string, string> = {
            event: c.type === "review_comment" ? "review_comment" : "pr_comment",
            author: c.author,
          };
          if (c.path) meta.path = c.path;
          if (c.line != null) meta.line = String(c.line);

          await notify({ content, meta });
        }
        commentSince = new Date().toISOString();
      }

      // CI チェック（Check Runs API — Events API には含まれない）
      if (currentBranch) {
        debugLog("fetching check runs...");
        const checkRuns = await fetchCheckRuns(owner, repo, currentBranch, token);
        for (const cr of checkRuns) {
          if (cr.status !== "completed") continue;
          const prev = seenCheckRunConclusions.get(cr.id);
          if (prev === cr.conclusion) continue;
          seenCheckRunConclusions.set(cr.id, cr.conclusion);

          const filter = events.check_run;
          if (!filter) continue;
          if (filter !== true && filter.conclusion && !filter.conclusion.includes(cr.conclusion ?? "")) continue;

          let content = `CI ${cr.conclusion}: ${cr.name}\nDetails: ${cr.html_url}`;

          // Fetch logs for failures
          if (cr.conclusion === "failure") {
            const runIdMatch = cr.html_url.match(/\/runs\/(\d+)/);
            if (runIdMatch) {
              try {
                const logs = await fetchFailedJobLogs(owner, repo, parseInt(runIdMatch[1]), token);
                content += `\n\nLogs:\n${logs}`;
              } catch {}
            }
          }

          await notify({
            content,
            meta: {
              event: "check_run",
              conclusion: cr.conclusion ?? "unknown",
              workflow: cr.name,
            },
          });
        }
      }

      // コンフリクト検出
      debugLog("checking for conflicts...");
      const conflict = checkConflictWithBase();
      if (conflict.hasConflict && !lastConflictState) {
        await notify({
          content: `Merge conflict detected with base branch.\nConflicting files:\n${conflict.files.map((f) => `- ${f}`).join("\n") || "(unknown)"}`,
          meta: { event: "conflict" },
        });
      }
      lastConflictState = conflict.hasConflict;

      // メモリ制限
      for (const [set, limit] of [[seenIds, 500], [seenCommentIds, 500]] as const) {
        if (set.size > limit) {
          const arr = [...set];
          set.clear();
          arr.slice(-limit).forEach((id) => (set as Set<typeof id>).add(id));
        }
      }
    }
  } catch (err) {
    log(`poll error: ${err}`);
    if (debug) console.error(err);
  }

  setTimeout(poll, pollInterval);
}

log(`${owner}/${repo} — polling every ${pollInterval / 1000}s when PR is active`);
if (debug) log("Debug mode enabled");
poll();
