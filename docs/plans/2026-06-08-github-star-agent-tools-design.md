# GitHub Star Agent Tools Design

Date: 2026-06-08
Status: Approved for implementation planning

## Goal

Let the LingMo agent use the user's configured GitHub token to read and manage the user's GitHub starred repositories. The first target workflow is:

> "帮我总结最近一周 GitHub 上都添加了哪些星标开源项目"

The agent should also support explicit management actions such as starring, unstarring, updating local categories or tags, and subscribing to release updates.

## Current Context

LingMo already has a substantial GitHub Stars feature surface:

- `src/lib/github-stars/api.ts` wraps GitHub REST API calls, token lookup, proxy support, retries, and typed repository/release/fork conversion.
- `src/db/github-stars.ts` stores starred repositories, releases, forks, local analysis fields, categories, and read state.
- `src/stores/github-stars.ts` orchestrates syncing, filtering, AI analysis, discovery channels, releases, forks, and star/unstar actions.
- `src/lib/agent/tools/github-trending-tools.ts` exposes public GitHub discovery tools to the agent.

The gap is that the agent tool layer only exposes public discovery tools. It does not expose personal starred repository data or management operations, so the agent cannot answer user-specific GitHub Star questions even though the app already can.

## Recommended Approach

Add an internal GitHub Star agent service plus a focused agent tool module.

Files to add or update:

- `src/lib/github-stars/agent-service.ts`
- `src/lib/agent/tools/github-star-tools.ts`
- `src/lib/agent/tools/index.ts`
- `src/lib/agent/tool-policy.ts`

This keeps the feature inside LingMo's existing GitHub Stars architecture instead of introducing an MCP server or a second GitHub client.

## Tool Surface

### Read Tools

Read tools are low risk and should not require confirmation.

- `github_sync_starred`
  - Sync the authenticated user's starred repositories into the local database.
  - Supports an optional `force` flag and returns sync counts plus latest sync time.

- `github_list_starred`
  - List starred repositories from local storage.
  - Supports filters for query, language, category, analyzed state, date range, and limit.

- `github_summarize_recent_stars`
  - Return a structured summary payload for repositories starred within the last N days.
  - Default range: 7 days.
  - Includes additions, language distribution, category/topic grouping, noteworthy projects, and possible follow-up actions.

- `github_search_my_stars`
  - Search within the user's starred repositories.
  - Prefer existing local text matching first, with optional AI search when the model is configured.

- `github_list_star_releases`
  - List releases for subscribed or selected starred repositories.
  - Supports unread-only, prerelease inclusion, repository filter, and date range.

- `github_list_my_forks`
  - List the user's fork repositories from local storage, with optional refresh.

### Management Tools

Management tools should be available only when the user's prompt clearly asks for write behavior.

- `github_star_repo`
  - Star a repository and upsert it into local storage.
  - Medium risk, confirmation required.

- `github_unstar_repo`
  - Unstar a repository and mark it unstarred locally.
  - High risk, confirmation required.

- `github_update_star_category`
  - Update the local category for a starred repository.
  - Medium risk, confirmation required.

- `github_update_star_notes_tags`
  - Update local custom description and custom tags.
  - Medium risk, confirmation required.

- `github_subscribe_star_releases`
  - Toggle release subscription for a starred repository.
  - Medium risk, confirmation required.

- `github_mark_release_read`
  - Mark a release as read.
  - Low or medium risk. Prefer low risk because it is reversible only by future tooling, but does not alter GitHub remote state.

## Data Flow

Read flow:

1. Agent receives a personal Star question.
2. Tool reads from local `github_star_repositories`.
3. If local data is empty or stale and the tool allows refresh, it calls existing GitHub API sync logic.
4. Service filters and summarizes repositories.
5. Tool returns compact structured data and a human-readable message.
6. Agent writes the final answer in the user's language.

Management flow:

1. Agent receives an explicit management request.
2. Tool policy checks write/destructive intent.
3. Confirmation is requested for medium/high risk operations.
4. Tool calls the existing GitHub API wrapper.
5. Local database is updated to match remote state.
6. Tool returns the remote action result and local cache update status.

## Token And Permissions

Use the existing token lookup order in `src/lib/github-stars/api.ts`:

1. `accessToken`
2. `githubStarsAccessToken`
3. `githubProjectApiToken`

Do not expose token values in logs, tool messages, or final answers.

Required GitHub capabilities:

- Read starred repositories for the authenticated user.
- Star and unstar repositories when management tools are used.
- Read repositories and releases for analysis and release tracking.

If no usable token exists, tools should return a clear setup error that points to GitHub sync/settings configuration.

## Error Handling

Use existing API errors from `requestGitHub` where possible. Tool-level messages should normalize common cases:

- Missing token: ask the user to configure a GitHub token in settings.
- Invalid token: explain that the token is invalid or expired.
- Rate limited: show the reset time if available.
- Network/proxy timeout: mention proxy/network settings.
- Empty result: distinguish between "no matching stars" and "not synced yet".

Write tools should report remote failure before attempting local state updates. If remote succeeds and local update fails, return a partial-success message and suggest a resync.

## Output Shape

Tool results should include both `data` and `message`.

For recent-star summaries, `data` should contain:

- `rangeDays`
- `from`
- `to`
- `total`
- `repositories`
- `languages`
- `categories`
- `topics`
- `noteworthy`

`message` should be compact Markdown suitable for direct display, but the agent can still compose a richer final answer from `data`.

## Safety

Add explicit risk entries to `src/lib/agent/tool-policy.ts`:

- Medium risk: star repo, update category/tags, toggle release subscription.
- High risk: unstar repo.
- Read-only: sync/list/summarize/search/list releases/list forks.

The implementation should avoid broad new permissions and should not add a new dependency.

## Testing

Add focused tests around the service layer where practical:

- Recent-star filtering by `starredAt`.
- Summary grouping by language and category/topic.
- Empty local state behavior.
- Risk classification for new tools.
- Parameter validation for `owner/repo` repository names.

Run at least:

- `pnpm typecheck`
- `pnpm test:agent` if it covers tool registration or policy behavior

Manual smoke checks:

- Ask the agent to summarize stars from the last 7 days.
- Ask the agent to search personal stars by topic.
- Ask the agent to star a harmless public test repository and verify confirmation appears.
- Ask the agent to unstar and verify high-risk confirmation appears.

## Rejected Approaches

### MCP server first

Rejected for the first implementation because LingMo already has token handling, proxy support, database persistence, UI state, and GitHub Stars domain logic. An MCP server can be added later by wrapping the same service layer.

### Extend only `github-trending-tools.ts`

Rejected because public discovery and personal Star management have different risk, token, and local persistence concerns. A separate tool file keeps boundaries clearer.

### Direct GitHub calls inside each agent tool

Rejected because it would duplicate token lookup, proxy behavior, retries, response parsing, and local cache updates already present in `src/lib/github-stars/api.ts` and `src/db/github-stars.ts`.

## Implementation Readiness

The design is ready for an implementation plan. The next step is to create a task plan that sequences service extraction, tool registration, policy updates, tests, and verification.
