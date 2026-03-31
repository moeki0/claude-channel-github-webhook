import type { EventFilter } from "./config";

export interface Notification {
  [key: string]: unknown;
  content: string;
  meta: Record<string, string>;
}

export function buildNotification(
  event: string,
  payload: Record<string, unknown>,
  events: Record<string, EventFilter>,
): Notification | null {
  const filter = events[event];
  if (!filter) return null;

  switch (event) {
    case "pull_request_review":
      return buildPrReview(payload);

    case "check_run":
      return buildCheckRun(payload, filter);

    case "issue_comment":
      return buildIssueComment(payload, filter);

    default:
      return buildGeneric(event, payload);
  }
}

function buildPrReview(payload: Record<string, unknown>): Notification {
  const pr = payload.pull_request as {
    title?: string;
    number: number;
    html_url?: string;
  };
  const review = payload.review as {
    user: { login: string };
    state: string;
    body?: string;
  };
  return {
    content: [
      `PR review on "${pr.title ?? `#${pr.number}`}" (#${pr.number})`,
      `Reviewer: ${review.user.login}`,
      `State: ${review.state}`,
      `Comment: ${review.body ?? "(none)"}`,
      ...(pr.html_url ? [`URL: ${pr.html_url}`] : []),
    ].join("\n"),
    meta: {
      event: "pull_request_review",
      pr_number: String(pr.number),
      author: review.user.login,
      reviewer: review.user.login,
      state: review.state,
    },
  };
}

function buildCheckRun(payload: Record<string, unknown>, filter: EventFilter): Notification | null {
  const checkRun = payload.check_run as {
    name: string;
    conclusion: string;
    html_url: string;
    check_suite: { head_branch: string };
  };

  if (filter !== true && filter.conclusion && !filter.conclusion.includes(checkRun.conclusion)) {
    return null;
  }

  const logs = payload._failedLogs as string | undefined;
  const content = [
    `CI ${checkRun.conclusion}: ${checkRun.name}`,
    `Branch: ${checkRun.check_suite.head_branch}`,
    `Details: ${checkRun.html_url}`,
  ];
  if (logs) content.push(`\nLogs:\n${logs}`);

  return {
    content: content.join("\n"),
    meta: {
      event: "check_run",
      conclusion: checkRun.conclusion,
      branch: checkRun.check_suite.head_branch,
      workflow: checkRun.name,
    },
  };
}

function buildIssueComment(payload: Record<string, unknown>, filter: EventFilter): Notification | null {
  const issue = payload.issue as { title: string };
  const comment = payload.comment as { body: string; html_url: string };

  if (filter !== true && filter.mention) {
    const pattern = new RegExp(`${filter.mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (!pattern.test(comment.body)) return null;
  }

  return {
    content: [
      `Mentioned in: ${issue.title}`,
      `Comment: ${comment.body}`,
      `URL: ${comment.html_url}`,
    ].join("\n"),
    meta: {
      event: "issue_comment",
      issue_title: issue.title,
    },
  };
}

function buildGeneric(event: string, payload: Record<string, unknown>): Notification {
  return {
    content: JSON.stringify(payload, null, 2).slice(0, 2000),
    meta: { event },
  };
}

