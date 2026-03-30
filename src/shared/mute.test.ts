import { describe, it, expect, beforeEach } from "@jest/globals";
import { MuteManager } from "./mute";

let mute: MuteManager;

beforeEach(() => {
  mute = new MuteManager();
});

describe("MuteManager", () => {
  it("デフォルトはミュートされていない", () => {
    expect(mute.isMuted()).toBe(false);
  });

  it("グローバルミュートできる", () => {
    mute.muteAll();
    expect(mute.isMuted()).toBe(true);
  });

  it("ミュート解除できる", () => {
    mute.muteAll();
    mute.unmute();
    expect(mute.isMuted()).toBe(false);
  });

  it("時間指定ミュートが期限切れで自動解除される", () => {
    mute.muteFor(0); // 0ms = 即期限切れ
    expect(mute.isMuted()).toBe(false);
  });

  it("時間指定ミュートが有効期間中はミュートされる", () => {
    mute.muteFor(60000); // 1分
    expect(mute.isMuted()).toBe(true);
  });

  it("ステータスを返す", () => {
    expect(mute.status()).toBe("unmuted");
    mute.muteAll();
    expect(mute.status()).toBe("muted (indefinite)");
  });

  it("時間指定ミュートのステータスに残り時間が含まれる", () => {
    mute.muteFor(60000);
    expect(mute.status()).toMatch(/muted \(\d+s remaining\)/);
  });
});
