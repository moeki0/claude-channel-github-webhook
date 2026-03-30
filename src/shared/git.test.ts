import { describe, it, expect } from "@jest/globals";
import { parseRemote } from "./git";

describe("parseRemote", () => {
  it("SSH URL から owner/repo を取得する", () => {
    expect(parseRemote("git@github.com:moeki0/TextZen.git")).toEqual({ owner: "moeki0", repo: "TextZen" });
  });

  it("HTTPS URL から owner/repo を取得する", () => {
    expect(parseRemote("https://github.com/moeki0/TextZen.git")).toEqual({ owner: "moeki0", repo: "TextZen" });
  });

  it("HTTPS URL (.git なし) から owner/repo を取得する", () => {
    expect(parseRemote("https://github.com/moeki0/TextZen")).toEqual({ owner: "moeki0", repo: "TextZen" });
  });

  it("不正な URL は null を返す", () => {
    expect(parseRemote("not-a-url")).toBeNull();
  });
});
