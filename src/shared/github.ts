import type { EventFilter } from "./config";

export interface GitHubEvent {
  id: string;
  event: string;
  created_at: string;
  payload: Record<string, unknown>;
}

export function filterByPr(
  items: GitHubEvent[],
  prNumber: number,
): GitHubEvent[] {
  return items.filter((item) => {
    // pull_request_review, pull_request: payload.pull_request.number
    const pr = item.payload.pull_request as { number?: number } | undefined;
    if (pr?.number != null) return pr.number === prNumber;

    // issue_comment: payload.issue.number
    const issue = item.payload.issue as { number?: number } | undefined;
    if (issue?.number != null) return issue.number === prNumber;

    // check_run: payload.check_run.pull_requests[].number
    const checkRun = item.payload.check_run as {
      pull_requests?: Array<{ number: number }>;
    } | undefined;
    if (checkRun?.pull_requests) {
      return checkRun.pull_requests.some((p) => p.number === prNumber);
    }

    // PR番号を特定できないイベントは除外
    return false;
  });
}

export function filterEvents(
  items: GitHubEvent[],
  events: Record<string, EventFilter>,
): GitHubEvent[] {
  return items.filter((item) => {
    const filter = events[item.event];
    if (!filter) return false;
    if (filter === true) return true;

    if (filter.conclusion) {
      const checkRun = item.payload.check_run as { conclusion?: string } | undefined;
      if (checkRun && !filter.conclusion.includes(checkRun.conclusion ?? "")) return false;
    }

    if (filter.mention) {
      const comment = item.payload.comment as { body?: string } | undefined;
      if (comment) {
        const pattern = new RegExp(`${filter.mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        if (!pattern.test(comment.body ?? "")) return false;
      }
    }

    return true;
  });
}

export async function fetchEvents(
  owner: string,
  repo: string,
  token: string,
  since: string,
): Promise<GitHubEvent[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `https://api.github.com/repos/${owner}/${repo}/events?per_page=30`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const raw = (await res.json()) as Array<{
    id: string;
    type: string;
    created_at: string;
    payload: Record<string, unknown>;
  }>;

  const sinceDate = new Date(since);
  return raw
    .filter((e) => new Date(e.created_at) > sinceDate)
    .map((e) => ({
      id: e.id,
      event: typeToEvent(e.type),
      created_at: e.created_at,
      payload: e.payload,
    }));
}

export interface CheckRun {
  id: number;
  name: string;
  conclusion: string | null;
  status: string;
  html_url: string;
  completed_at: string | null;
}

export async function fetchCheckRuns(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<CheckRun[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}/check-runs`;
  const res = await fetch(url, { headers });
  if (!res.ok) return [];

  const data = (await res.json()) as { check_runs: CheckRun[] };
  return data.check_runs;
}

export interface PrComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
  html_url: string;
}

export interface ReviewComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
  html_url: string;
  path: string;
  line: number | null;
  diff_hunk: string;
  in_reply_to_id?: number;
}

export interface NormalizedComment {
  id: number;
  type: "comment" | "review_comment";
  author: string;
  body: string;
  created_at: string;
  html_url: string;
  path?: string;
  line?: number | null;
  diff_hunk?: string;
}

export function normalizeComment(comment: PrComment | ReviewComment): NormalizedComment {
  const isReview = "path" in comment;
  return {
    id: comment.id,
    type: isReview ? "review_comment" : "comment",
    author: comment.user.login,
    body: comment.body,
    created_at: comment.created_at,
    html_url: comment.html_url,
    ...(isReview ? { path: comment.path, line: comment.line, diff_hunk: comment.diff_hunk } : {}),
  };
}

export async function fetchPrComments(
  owner: string,
  repo: string,
  prNumber: number,
  since: string,
  token: string,
): Promise<NormalizedComment[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Conversation comments
  const issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?since=${since}&per_page=100`;
  const issueRes = await fetch(issueUrl, { headers });
  const issueComments = issueRes.ok ? ((await issueRes.json()) as PrComment[]) : [];

  // Inline review comments
  const reviewUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments?since=${since}&per_page=100&sort=created&direction=desc`;
  const reviewRes = await fetch(reviewUrl, { headers });
  const reviewComments = reviewRes.ok ? ((await reviewRes.json()) as ReviewComment[]) : [];

  return [
    ...issueComments.map(normalizeComment),
    ...reviewComments.map(normalizeComment),
  ];
}

export interface PullRequest {
  number: number;
  title: string;
  html_url: string;
  head: { ref: string };
}

export async function findPrForBranch(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<PullRequest | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open&per_page=1`;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;

  const prs = (await res.json()) as PullRequest[];
  return prs[0] ?? null;
}

const MAX_LOG_LENGTH = 2000;

export async function fetchFailedJobLogs(
  owner: string,
  repo: string,
  runId: number,
  token: string,
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Get failed jobs
  const jobsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs?filter=latest`;
  const jobsRes = await fetch(jobsUrl, { headers });
  if (!jobsRes.ok) return "(failed to fetch job info)";

  const jobsData = (await jobsRes.json()) as {
    jobs: Array<{ id: number; name: string; conclusion: string; steps?: Array<{ name: string; conclusion: string }> }>;
  };

  const failedJobs = jobsData.jobs.filter((j) => j.conclusion === "failure");
  if (failedJobs.length === 0) return "(no failed jobs found)";

  const summaries: string[] = [];
  for (const job of failedJobs) {
    const failedSteps = (job.steps ?? []).filter((s) => s.conclusion === "failure");
    summaries.push(
      `Job: ${job.name}\nFailed steps: ${failedSteps.map((s) => s.name).join(", ") || "(unknown)"}`,
    );

    // Try to fetch logs for this job
    const logUrl = `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`;
    const logRes = await fetch(logUrl, { headers, redirect: "follow" });
    if (logRes.ok) {
      const logText = await logRes.text();
      // Keep last N chars (most useful part of logs)
      const trimmed = logText.length > MAX_LOG_LENGTH
        ? "...(truncated)\n" + logText.slice(-MAX_LOG_LENGTH)
        : logText;
      summaries.push(trimmed);
    }
  }

  return summaries.join("\n---\n");
}

function typeToEvent(type: string): string {
  const map: Record<string, string> = {
    PullRequestReviewEvent: "pull_request_review",
    CheckRunEvent: "check_run",
    IssueCommentEvent: "issue_comment",
    PushEvent: "push",
    PullRequestEvent: "pull_request",
    CreateEvent: "create",
    DeleteEvent: "delete",
    ReleaseEvent: "release",
    WorkflowRunEvent: "workflow_run",
  };
  return map[type] ?? type.replace(/Event$/, "").toLowerCase();
}
