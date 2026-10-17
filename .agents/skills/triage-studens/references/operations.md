# Board operations

Use live IDs from the audit JSON. These recipes are not cached board state.

## Inventory and planning

The read-only helper requires Node and authenticated `gh` access to the project and repository. A nonzero result can mean a board finding; inspect `findings` and stderr. Use a fresh output path for each run.

```bash
node .agents/skills/triage-studens/scripts/audit.mjs --out /tmp/studens-board-before.json
gh issue list --repo max-miller1204/studens --state open --limit 200 --json number,title,url,labels,assignees
gh pr list --repo max-miller1204/studens --state open --limit 100 --json number,title,url,isDraft,closingIssuesReferences
gh pr view <number> --repo max-miller1204/studens --json state,isDraft,mergedAt,closingIssuesReferences,statusCheckRollup,reviewDecision
```

If an inventory reaches its limit, paginate before claiming completeness. The helper paginates project items and server-filtered view matches and flags truncated nested evidence. Fetch further labels, blockers, or PR references before acting on an incomplete connection.

Save the issue-by-issue plan, before snapshot, exact mutation payloads, completed writes, and after snapshot together in a scratch directory. Issue bodies and project data stay out of Git. Creating this skill does not authorize testing mutations against the live board.

## Mutations

Use structured arguments, JSON request files, or `spawnSync` argument arrays with `gh api --input -`. Do not interpolate issue titles or multiline descriptions into shell command text. Let `gh` handle authentication; do not extract its token.

```graphql
mutation ($input: UpdateProjectV2ItemFieldValueInput!) {
  updateProjectV2ItemFieldValue(input: $input) {
    projectV2Item {
      id
    }
  }
}
```

```json
{
  "input": {
    "projectId": "LIVE_PROJECT_ID",
    "itemId": "LIVE_ITEM_ID",
    "fieldId": "LIVE_FIELD_ID",
    "value": { "singleSelectOptionId": "LIVE_OPTION_ID" }
  }
}
```

- Defer using `clearProjectV2ItemFieldValue` for Focus with `{projectId, itemId, fieldId}`, then set Backlog. Select work by setting Focus before Ready. Recovery reads both fields before continuing the remaining step.
- Add missing existing issues with `addProjectV2ItemById`, then set intended fields. Retain its returned item ID and check membership before retrying an uncertain add.
- Use repository issue APIs for labels, assignments, native relationships, and close reasons. Project Status alone does not change issue state.
- Use `updateProjectV2View` with the current `viewId` and intended `name`, `filter`, `layout`, or `configuration.visibleFieldIds`. Preserve existing single-select option IDs when updating descriptions/options, so assignments and workflows survive.
- GraphQL does not expose every display setting. Use browser controls for hierarchy, columns, slicing, grouping, and workflow mappings. Recreate views only when in-place repair is unavailable; verify replacements before removing originals and report the new URLs.
- For recreation, the tested REST endpoint is `POST /users/max-miller1204/projectsV2/8/views` with `name`, `layout`, `filter`, `visible_fields`, `group_by`, `vertical_group_by`, and `sort_by`. REST takes numeric field `databaseId` values; GraphQL takes node IDs. Do not assume that a create endpoint implies an update endpoint.

The helper uses `ProjectV2.items(query: ...)` to evaluate saved filters on the server. This establishes membership, not visual visibility or a view's saved hierarchy setting.

## Chrome verification

Use host browser tools first unless the user names Chrome/Playwright. For Playwright, load the available playwright-cli skill and attach to the user's signed-in Chrome through its extension:

```bash
playwright-cli -s=studens-triage attach --extension=chrome
playwright-cli -s=studens-triage tab-list
```

Reuse a project tab or open the current URL from the audit. Do not navigate or close unrelated tabs. A fresh `open --browser=chrome` may be logged out even though the user's Chrome is signed in. If attachment fails, report the missing prerequisite. If GitHub requests sign-in, let the user authenticate; do not read browser credentials from disk.

```bash
playwright-cli -s=studens-triage tab-new https://github.com/users/max-miller1204/projects/8
playwright-cli -s=studens-triage snapshot
```

Use observed refs or role locators. Refresh snapshots after navigation. Wait for initially disabled/loading cards to become interactive. Check at the actual narrow window width.

### Now and Next

1. Select the view; confirm the Focus filter and real issue cards.
2. If empty Triage or Backlog columns come first, open **Actions for column: Triage** / **Actions for column: Backlog**, then **Hide from view**. This changes the filter without deleting statuses or issues. Keep Ready, In progress, and In review visible.
3. Click **Save**, then **Save** inside the **Save filters for …?** alert dialog. The first click alone leaves the change uncommitted.
4. Reopen the base URL. Confirm Ready is first and actual cards are visible without horizontal scrolling. Inspect screenshots before citing them.

### Tables

- All items: **View → Show hierarchy → Off**. With pending changes, the button may be named **Unsaved changes View**. Open it, click **Save view**, and confirm **Save display options for …?**. Reopen the base URL. Count issue rows, excluding the header and add-item row. Unfiltered views may have no matching-items counter.
- Backlog: check unselected ordinary work, including blank priorities. Remove grouping/slicing that conceals unprioritized items.
- Roadmap: inspect epic outcomes and sub-issue progress. Preserve native relationships and the absence of dates.
- Triage: an empty queue is valid; closed issues should not linger here.

The UI counter can exclude children collapsed under their parent. Check actual flat rows and the saved hierarchy setting instead of comparing counters alone.

Leave Chrome and the useful project tab open; detach only your connection:

```bash
playwright-cli -s=studens-triage detach
```

## Workflows

Inspect enabled rules and their targets in the project **Workflows** screen. Names and enabled flags from the API do not establish action mappings.

- Intake should set Triage. Auto-add should target the intended repository, including sub-issues.
- Review-ready linked work should reach In review; inspect handling of draft PRs before relying on the rule.
- Completed issues / appropriate merged closing PRs should reach Done. Auto-close should target Done, not Ready or Canceled.
- Closing as not planned can trigger the generic closed-item rule and overwrite Canceled with Done. Read the result and repair it.
- Focus advances only through explicit planning, independently of dates and PR events.

Preserve unrelated rules. Do not introduce PAT secrets, Actions, a scheduler, public access, or new integrations to solve a native UI setting. If mappings cannot be inspected, report them as unverified.
