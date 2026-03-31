import { describe, it, expect } from "@jest/globals";
import { filterEvents, filterByPr, normalizeComment } from "./github";
import type { GitHubEvent, PrComment, ReviewComment } from "./github";

describe("filterEvents", () => {
  const events: Record<string, true | { conclusion?: string[]; mention?: string }> = {
    pull_request_review: true,
    check_run: { conclusion: ["failure"] },
    issue_comment: { mention: "@claude" },
  };

  it("pull_request_review を通過させる", () => {
    const items: GitHubEvent[] = [
      { id: "1", event: "pull_request_review", created_at: "2026-03-30T00:00:00Z", payload: { review: { state: "approved" } } },
    ];
    expect(filterEvents(items, events)).toHaveLength(1);
  });

  it("check_run failure を通過させる", () => {
    const items: GitHubEvent[] = [
      { id: "2", event: "check_run", created_at: "2026-03-30T00:00:00Z", payload: { check_run: { conclusion: "failure" } } },
    ];
    expect(filterEvents(items, events)).toHaveLength(1);
  });

  it("check_run success を除外する", () => {
    const items: GitHubEvent[] = [
      { id: "3", event: "check_run", created_at: "2026-03-30T00:00:00Z", payload: { check_run: { conclusion: "success" } } },
    ];
    expect(filterEvents(items, events)).toHaveLength(0);
  });

  it("issue_comment に @claude を含む場合のみ通過させる", () => {
    const items: GitHubEvent[] = [
      { id: "4", event: "issue_comment", created_at: "2026-03-30T00:00:00Z", payload: { comment: { body: "hey @claude fix this" } } },
      { id: "5", event: "issue_comment", created_at: "2026-03-30T00:00:00Z", payload: { comment: { body: "just a comment" } } },
    ];
    expect(filterEvents(items, events)).toHaveLength(1);
    expect(filterEvents(items, events)[0].id).toBe("4");
  });

  it("events に含まれないイベントを除外する", () => {
    const items: GitHubEvent[] = [
      { id: "6", event: "push", created_at: "2026-03-30T00:00:00Z", payload: {} },
    ];
    expect(filterEvents(items, events)).toHaveLength(0);
  });
});

describe("filterByPr", () => {
  it("pull_request_review を PR 番号でフィルタする", () => {
    const items: GitHubEvent[] = [
      {
        id: "1",
        event: "pull_request_review",
        created_at: "2026-03-30T00:00:00Z",
        payload: { pull_request: { number: 42 }, review: { state: "approved" } },
      },
      {
        id: "2",
        event: "pull_request_review",
        created_at: "2026-03-30T00:00:00Z",
        payload: { pull_request: { number: 99 }, review: { state: "approved" } },
      },
    ];
    const result = filterByPr(items, 42);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("issue_comment を PR 番号でフィルタする", () => {
    const items: GitHubEvent[] = [
      {
        id: "3",
        event: "issue_comment",
        created_at: "2026-03-30T00:00:00Z",
        payload: { issue: { number: 42 }, comment: { body: "@claude help" } },
      },
      {
        id: "4",
        event: "issue_comment",
        created_at: "2026-03-30T00:00:00Z",
        payload: { issue: { number: 10 }, comment: { body: "@claude help" } },
      },
    ];
    const result = filterByPr(items, 42);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("3");
  });

  it("check_run を pull_requests 配列の PR 番号でフィルタする", () => {
    const items: GitHubEvent[] = [
      {
        id: "5",
        event: "check_run",
        created_at: "2026-03-30T00:00:00Z",
        payload: { check_run: { conclusion: "failure", pull_requests: [{ number: 42 }] } },
      },
      {
        id: "6",
        event: "check_run",
        created_at: "2026-03-30T00:00:00Z",
        payload: { check_run: { conclusion: "failure", pull_requests: [{ number: 99 }] } },
      },
    ];
    const result = filterByPr(items, 42);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("5");
  });

  it("PR 番号を特定できないイベントは除外する", () => {
    const items: GitHubEvent[] = [
      { id: "7", event: "push", created_at: "2026-03-30T00:00:00Z", payload: {} },
    ];
    expect(filterByPr(items, 42)).toHaveLength(0);
  });
});

describe("normalizeComment", () => {
  it("PR 会話コメントを正規化する", () => {
    const comment: PrComment = {
      id: 1,
      body: "Looks good!",
      user: { login: "alice" },
      created_at: "2026-03-30T00:00:00Z",
      html_url: "https://github.com/org/repo/pull/42#issuecomment-1",
    };
    const result = normalizeComment(comment);
    expect(result.author).toBe("alice");
    expect(result.body).toBe("Looks good!");
    expect(result.type).toBe("comment");
  });

  it("インラインレビューコメントを正規化する（diff ハンク付き）", () => {
    const comment: ReviewComment = {
      id: 2,
      body: "Use const here",
      user: { login: "bob" },
      created_at: "2026-03-30T00:00:00Z",
      html_url: "https://github.com/org/repo/pull/42#discussion_r2",
      path: "src/index.ts",
      line: 10,
      diff_hunk: "@@ -8,3 +8,3 @@\n-let x = 1;\n+var x = 1;",
    };
    const result = normalizeComment(comment);
    expect(result.type).toBe("review_comment");
    expect(result.path).toBe("src/index.ts");
    expect(result.line).toBe(10);
    expect(result.diff_hunk).toContain("var x = 1");
  });
});
