import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, CONFIG_PATH } from "./config";

let tmpFile: string;

beforeEach(() => {
  tmpFile = path.join(os.tmpdir(), `gh-webhook-config-test-${Date.now()}.json`);
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
});

afterEach(() => {
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
});

describe("loadConfig", () => {
  it("設定ファイルから token を読み込む", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ token: "ghp_xxx" }));
    const config = loadConfig(tmpFile);
    expect(config.token).toBe("ghp_xxx");
  });

  it("token は省略可能（gh CLI があればそこから取得）", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({}));
    const config = loadConfig(tmpFile);
    // gh CLI がある環境ではトークンが取得される、なければ空
    expect(typeof config.token).toBe("string");
  });

  it("GITHUB_TOKEN 環境変数で上書きできる", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ token: "from-file" }));
    process.env.GITHUB_TOKEN = "from-env";
    const config = loadConfig(tmpFile);
    expect(config.token).toBe("from-env");
  });

  it("設定ファイルがなくても動作する（デフォルト値）", () => {
    const config = loadConfig(tmpFile);
    expect(typeof config.token).toBe("string");
    expect(config.pollInterval).toBe(30000);
  });

  it("pollInterval のデフォルトは 30000", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({}));
    const config = loadConfig(tmpFile);
    expect(config.pollInterval).toBe(30000);
  });

  it("pollInterval をカスタマイズできる", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ pollInterval: 60000 }));
    const config = loadConfig(tmpFile);
    expect(config.pollInterval).toBe(60000);
  });

  it("events が未指定ならデフォルトフィルタを使う", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({}));
    const config = loadConfig(tmpFile);
    expect(config.events.pull_request_review).toBe(true);
    expect(config.events.check_run).toEqual({ conclusion: ["failure"] });
    expect(config.events.issue_comment).toBe(true);
  });

  it("events をカスタマイズできる", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({
      events: {
        push: true,
        check_run: { conclusion: ["failure", "cancelled"] },
      },
    }));
    const config = loadConfig(tmpFile);
    expect(config.events.push).toBe(true);
    expect(config.events.check_run).toEqual({ conclusion: ["failure", "cancelled"] });
    expect(config.events.pull_request_review).toBeUndefined();
  });
  it("trustedUsers のデフォルトは空配列", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({}));
    const config = loadConfig(tmpFile);
    expect(config.trustedUsers).toEqual([]);
  });

  it("trustedUsers を設定できる", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ trustedUsers: ["moeki0", "alice"] }));
    const config = loadConfig(tmpFile);
    expect(config.trustedUsers).toEqual(["moeki0", "alice"]);
  });

  it("trustedBots のデフォルトは空配列", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({}));
    const config = loadConfig(tmpFile);
    expect(config.trustedBots).toEqual([]);
  });

  it("trustedBots を設定できる", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ trustedBots: ["claude-code[bot]", "dependabot[bot]"] }));
    const config = loadConfig(tmpFile);
    expect(config.trustedBots).toEqual(["claude-code[bot]", "dependabot[bot]"]);
  });

  it("debug のデフォルトは false", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({}));
    const config = loadConfig(tmpFile);
    expect(config.debug).toBe(false);
  });
});

describe("CONFIG_PATH", () => {
  it("~/.config/github-webhook-channel.json を指す", () => {
    expect(CONFIG_PATH).toBe(path.join(os.homedir(), ".config", "github-webhook-channel.json"));
  });
});
