import { execSync } from "node:child_process";

export function parseRemote(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (match) return { owner: match[1], repo: match[2] };
  return null;
}

export function detectRepo(): { owner: string; repo: string } | null {
  // Try gh CLI first (works regardless of cwd)
  try {
    const json = execSync("gh repo view --json owner,name", { encoding: "utf-8", stdio: "pipe" });
    const { owner, name } = JSON.parse(json);
    return { owner: owner.login, repo: name };
  } catch {
    // fall through
  }

  // Fallback: git remote
  try {
    const remote = execSync("git remote get-url origin", { encoding: "utf-8", stdio: "pipe" }).trim();
    return parseRemote(remote);
  } catch {
    return null;
  }
}

export function getCurrentBranch(): string | null {
  // Try gh CLI first
  try {
    const json = execSync("gh pr view --json headRefName", { encoding: "utf-8", stdio: "pipe" });
    const { headRefName } = JSON.parse(json);
    return headRefName || null;
  } catch {
    // fall through
  }

  // Fallback: git
  try {
    return execSync("git branch --show-current", { encoding: "utf-8", stdio: "pipe" }).trim() || null;
  } catch {
    return null;
  }
}

export function checkConflictWithBase(baseBranch = "origin/main"): { hasConflict: boolean; files: string[] } {
  try {
    execSync("git fetch origin --quiet", { encoding: "utf-8", stdio: "pipe" });

    const currentBranch = getCurrentBranch();
    if (!currentBranch) return { hasConflict: false, files: [] };

    const mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, { encoding: "utf-8", stdio: "pipe" }).trim();
    const result = execSync(`git merge-tree ${mergeBase} HEAD ${baseBranch}`, { encoding: "utf-8", stdio: "pipe" });

    const conflictFiles: string[] = [];
    const sections = result.split(/^diff --git/m);
    for (const section of sections) {
      if (section.includes("<<<<<<<")) {
        const fileMatch = section.match(/\+\+\+ b\/(.+)/);
        if (fileMatch) conflictFiles.push(fileMatch[1]);
      }
    }

    return { hasConflict: conflictFiles.length > 0, files: conflictFiles };
  } catch {
    return { hasConflict: false, files: [] };
  }
}
