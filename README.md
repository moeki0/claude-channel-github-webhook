# claude-channel-github-webhook

A Claude Code Channel plugin that delivers GitHub PR events as real-time notifications to your Claude Code session.

**Zero config required.** Automatically detects your repository and branch, finds the active PR, and starts monitoring. No webhooks, no tunnels, no exposed ports.

## Features

- **PR comments** — conversation and inline review comments with diff hunks
- **PR close/merge** — notified when the current PR is merged or closed
- **CI failure logs** — fetched and attached to notifications
- **Merge conflict detection** — checks against base branch every poll cycle
- **Branch switch auto-follow** — watches `.git/HEAD`, re-targets when you checkout
- **Mute tools** — `mute-gh`, `unmute-gh`, `mute-gh-status` (timed or indefinite)
- **Trust & security** — blocks external/bot authors, repo owner auto-trusted
- **Configurable event filters** — per-event rules via config file
- **Debug mode** — verbose logging for troubleshooting

## How It Works

```
git remote → detect owner/repo
git branch → find open PR → poll GitHub API → filter → notify Claude Code
                             (only when PR is active)
```

1. Detects `owner/repo` from git remote, token from `gh` CLI
2. Checks if the current branch has an open PR
3. If yes: polls GitHub API every 30s for events and PR comments
4. If no PR (or on main/master): idles, no API calls
5. On `git checkout`: auto-switches to the new branch's PR
6. Filters events, attaches CI logs on failure, checks for merge conflicts
7. Blocks comments from bots and untrusted external authors

## Quick Start

```bash
# Add the marketplace and install (one-time)
/plugin marketplace add moeki0/claude-channel-github-webhook
/plugin install github-webhook@claude-channel-github-webhook

# Start Claude Code with the channel enabled
claude --dangerously-load-development-channels plugin:github-webhook@claude-channel-github-webhook
```

If you have `gh` CLI authenticated, no further config is needed.

## Configuration (optional)

Create `~/.config/github-webhook-channel.json` to customize:

```json
{
  "token": "ghp_...",
  "pollInterval": 30000,
  "trustedUsers": ["teammate1", "teammate2"],
  "events": {
    "pull_request_review": true,
    "pull_request": true,
    "check_run": { "conclusion": ["failure"] },
    "issue_comment": true
  },
  "debug": false
}
```

All fields are optional. Defaults are applied for anything omitted.

| Field          | Description                                              | Default                             |
| -------------- | -------------------------------------------------------- | ----------------------------------- |
| `token`        | GitHub token                                             | Auto-detect from `gh` CLI           |
| `pollInterval` | Polling interval in ms                                   | `30000` (30s)                       |
| `trustedUsers` | GitHub usernames to trust (repo owner is always trusted) | `[]`                                |
| `events`       | Event filter rules (see below)                           | PR reviews + close/merge + CI failures + comments |
| `debug`        | Enable verbose logging                                   | `false`                             |

Environment variable overrides: `GITHUB_TOKEN`, `GH_TOKEN`, `GH_WEBHOOK_DEBUG=true`.

### Event Filter Rules

- `true` — pass all events of this type
- `{ "conclusion": ["failure", "cancelled"] }` — filter check_run by conclusion
- `{ "mention": "@claude" }` — filter issue_comment by mention
- Omitted events are ignored entirely

### Trust & Security

The `trustedUsers` list controls whose comments reach Claude Code:

- **Repo owner** is always trusted automatically
- Users in `trustedUsers` are marked `trust="team"` and their comments are delivered
- GitHub Apps can be trusted by adding their full name (e.g. `"github-actions[bot]"`) to `trustedUsers` — they are marked `trust="bot"`
- All other users are **blocked** — their comments never reach Claude
- When `trustedUsers` is empty, bot accounts (`[bot]` suffix) are blocked by default

When `trustedUsers` is empty (default), only the repo owner's comments are delivered.

## Mute Tools

Claude can call these MCP tools to control notifications:

| Tool             | Description                                                             |
| ---------------- | ----------------------------------------------------------------------- |
| `mute-gh`        | Pause notifications. Pass `minutes` for timed mute, omit for indefinite |
| `unmute-gh`      | Resume notifications                                                    |
| `mute-gh-status` | Check current mute status                                               |

Example: "Mute notifications for 30 minutes while I focus" → Claude calls `mute-gh` with `minutes: 30`.

## What Claude Receives

````xml
<channel source="github-webhook" event="review_comment" author="alice" trust="team" path="src/index.ts" line="42">
Review comment by alice on src/index.ts:42
```diff
@@ -40,3 +40,3 @@
-let x = 1;
+const x = 1;
```
Use const here
https://github.com/org/repo/pull/42#discussion_r123
</channel>
````

```xml
<channel source="github-webhook" event="check_run" conclusion="failure" branch="feat/x" workflow="CI / test">
CI failure: CI / test
Branch: feat/x
Details: https://github.com/org/repo/actions/runs/123

Logs:
Job: test
Failed steps: Run tests
...(truncated)
Error: expected 200 but got 500
</channel>
```

```xml
<channel source="github-webhook" event="conflict">
Merge conflict detected with base branch.
Conflicting files:
- src/index.ts
- package.json
</channel>
```

## Development

```bash
npm install
npm test        # Run tests
npm run lint    # Type check
npm run build   # Build before commit
```

### Running locally with Claude Code

Instead of installing via the plugin marketplace, you can run the source directly as an MCP server for development:

```bash
# Register as a user-level MCP server
claude mcp add github-webhook -s user -- npx tsx /path/to/claude-channel-github-webhook/src/channel.ts

# Start Claude Code with the channel enabled
claude --dangerously-load-development-channels mcp:github-webhook
```

This runs `src/channel.ts` directly via `tsx`, so source changes are reflected on restart without needing `npm run build`.

If `npx tsx` fails to resolve (e.g. `tsx` is only a local dependency), use the full path:

```bash
claude mcp add github-webhook -s user -- /path/to/claude-channel-github-webhook/node_modules/.bin/tsx /path/to/claude-channel-github-webhook/src/channel.ts
```

## Status

Claude Code Channels is in **Research Preview**.

- Requires Claude Code v2.1.80+
- Requires claude.ai login (not API key)
- Team/Enterprise orgs must enable `channelsEnabled`
