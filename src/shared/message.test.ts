import { describe, it, expect } from "@jest/globals";
import { buildNotification } from "./message";
import type { EventFilter } from "./config";

const defaultEvents: Record<string, EventFilter> = {
  pull_request_review: true,
  check_run: { conclusion: ["failure"] },
  issue_comment: true,
};

describe("buildNotification", () => {
  it("pull_request_review のメッセージと meta を組み立てる", () => {
    const payload = {
      pull_request: {
        title: "Add feature",
        number: 42,
        html_url: "https://github.com/org/repo/pull/42",
        head: { ref: "feat/add-feature" },
      },
      review: {
        user: { login: "reviewer" },
        state: "approved",
        body: "LGTM",
      },
    };
    const result = buildNotification("pull_request_review", payload, defaultEvents);
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Add feature");
    expect(result!.content).toContain("reviewer");
    expect(result!.meta.event).toBe("pull_request_review");
    expect(result!.meta.pr_number).toBe("42");
    expect(result!.meta.author).toBe("reviewer");
  });

  it("pull_request_review で html_url が欠落している場合でも undefined にならない", () => {
    const payload = {
      pull_request: { number: 1 },
      review: { user: { login: "bot" }, state: "commented", body: "test" },
    };
    const result = buildNotification("pull_request_review", payload, defaultEvents);
    expect(result).not.toBeNull();
    expect(result!.content).not.toContain("undefined");
  });

  it("check_run 失敗のメッセージを組み立てる", () => {
    const payload = {
      check_run: {
        name: "CI / test",
        conclusion: "failure",
        html_url: "https://github.com/org/repo/actions/runs/1",
        check_suite: { head_branch: "feat/add-feature" },
      },
    };
    const result = buildNotification("check_run", payload, defaultEvents);
    expect(result).not.toBeNull();
    expect(result!.content).toContain("CI / test");
    expect(result!.meta.conclusion).toBe("failure");
  });

  it("check_run 失敗にログが付いている場合は content に含める", () => {
    const payload = {
      check_run: {
        name: "CI / test",
        conclusion: "failure",
        html_url: "https://github.com/org/repo/actions/runs/1",
        check_suite: { head_branch: "feat/add-feature" },
      },
      _failedLogs: "Error: test failed\n  at test.ts:42",
    };
    const result = buildNotification("check_run", payload, defaultEvents);
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Logs:");
    expect(result!.content).toContain("Error: test failed");
  });

  it("check_run 成功はデフォルトで null を返す", () => {
    const payload = {
      check_run: {
        name: "CI / test",
        conclusion: "success",
        html_url: "https://github.com/org/repo/actions/runs/1",
        check_suite: { head_branch: "feat/add-feature" },
      },
    };
    expect(buildNotification("check_run", payload, defaultEvents)).toBeNull();
  });

  it("check_run: conclusion フィルタをカスタマイズできる", () => {
    const events = { check_run: { conclusion: ["failure", "cancelled"] } };
    const cancelled = {
      check_run: {
        name: "CI",
        conclusion: "cancelled",
        html_url: "https://example.com",
        check_suite: { head_branch: "main" },
      },
    };
    expect(buildNotification("check_run", cancelled, events)).not.toBeNull();

    const success = {
      check_run: {
        name: "CI",
        conclusion: "success",
        html_url: "https://example.com",
        check_suite: { head_branch: "main" },
      },
    };
    expect(buildNotification("check_run", success, events)).toBeNull();
  });

  it("check_run: true なら全ての conclusion を通過させる", () => {
    const events = { check_run: true as const };
    const success = {
      check_run: {
        name: "CI",
        conclusion: "success",
        html_url: "https://example.com",
        check_suite: { head_branch: "main" },
      },
    };
    expect(buildNotification("check_run", success, events)).not.toBeNull();
  });

  it("issue_comment: デフォルト(true)なら全コメントを通過させる", () => {
    const payload = {
      issue: { title: "Bug report" },
      comment: { body: "Just a regular comment", html_url: "https://example.com", user: { login: "alice" } },
    };
    const result = buildNotification("issue_comment", payload, defaultEvents);
    expect(result).not.toBeNull();
    expect(result!.meta.author).toBe("alice");
  });

  it("issue_comment: mention フィルタで @claude のみ通過させる", () => {
    const mentionEvents = { issue_comment: { mention: "@claude" } };
    const withMention = {
      issue: { title: "Bug report" },
      comment: { body: "Hey @claude please fix this", html_url: "https://example.com" },
    };
    const withoutMention = {
      issue: { title: "Bug report" },
      comment: { body: "Just a regular comment", html_url: "https://example.com" },
    };
    expect(buildNotification("issue_comment", withMention, mentionEvents)).not.toBeNull();
    expect(buildNotification("issue_comment", withoutMention, mentionEvents)).toBeNull();
  });

  it("issue_comment: @claudebot は @claude のメンションに一致しない", () => {
    const mentionEvents = { issue_comment: { mention: "@claude" } };
    const payload = {
      issue: { title: "Bug report" },
      comment: { body: "ask @claudebot", html_url: "https://example.com" },
    };
    expect(buildNotification("issue_comment", payload, mentionEvents)).toBeNull();
  });

  it("pull_request_review で title が欠落している場合でも動作する", () => {
    const payload = {
      pull_request: {
        number: 1564,
        html_url: "https://github.com/org/repo/pull/1564",
      },
      review: {
        user: { login: "moeki0" },
        state: "commented",
        body: "looks good",
      },
    };
    const result = buildNotification("pull_request_review", payload, defaultEvents);
    expect(result).not.toBeNull();
    expect(result!.content).not.toContain("undefined");
    expect(result!.content).toContain("#1564");
  });

  it("pull_request: マージされた場合の通知", () => {
    const events = { ...defaultEvents, pull_request: true as const };
    const payload = {
      action: "closed",
      pull_request: {
        number: 42,
        title: "Add feature",
        html_url: "https://github.com/org/repo/pull/42",
        merged: true,
        user: { login: "alice" },
      },
    };
    const result = buildNotification("pull_request", payload, events);
    expect(result).not.toBeNull();
    expect(result!.content).toContain("merged");
    expect(result!.meta.event).toBe("pull_request");
    expect(result!.meta.action).toBe("closed");
    expect(result!.meta.author).toBe("alice");
  });

  it("pull_request: クローズされた場合の通知", () => {
    const events = { ...defaultEvents, pull_request: true as const };
    const payload = {
      action: "closed",
      pull_request: {
        number: 42,
        title: "Add feature",
        html_url: "https://github.com/org/repo/pull/42",
        merged: false,
        user: { login: "alice" },
      },
    };
    const result = buildNotification("pull_request", payload, events);
    expect(result).not.toBeNull();
    expect(result!.content).toContain("closed");
    expect(result!.content).not.toContain("merged");
  });

  it("pull_request: open など他のアクションは無視する", () => {
    const events = { ...defaultEvents, pull_request: true as const };
    const payload = {
      action: "opened",
      pull_request: {
        number: 42,
        title: "Add feature",
        html_url: "https://github.com/org/repo/pull/42",
        merged: false,
        user: { login: "alice" },
      },
    };
    const result = buildNotification("pull_request", payload, events);
    expect(result).toBeNull();
  });

  it("events に含まれないイベントは null を返す", () => {
    expect(buildNotification("push", {}, defaultEvents)).toBeNull();
  });

  it("push: true で push イベントの生ペイロードを通過させる", () => {
    const events = { push: true as const };
    const payload = {
      ref: "refs/heads/main",
      repository: { full_name: "org/repo" },
    };
    const result = buildNotification("push", payload, events);
    expect(result).not.toBeNull();
    expect(result!.meta.event).toBe("push");
  });
});

