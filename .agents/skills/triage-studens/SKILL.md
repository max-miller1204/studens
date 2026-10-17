---
name: triage-studens
description: Triage studens issues and maintain its GitHub Projects board, including Now / Next / Backlog planning, priorities, dependencies, PR status reconciliation, and browser verification of saved views.
---

# Triage studens

Manage `max-miller1204/studens` and its private [studens-board](https://github.com/users/max-miller1204/projects/8). Follow the current AGENTS.md. This skill handles project management; implementing issues and merging PRs need their own task scope.

## Start with live evidence

From the repository root, run the read-only helper with a fresh output path:

```bash
node .agents/skills/triage-studens/scripts/audit.mjs --out /tmp/studens-board-before.json
```

The JSON contains the paginated item inventory, field and option IDs, views, enabled workflows, and API matches for each view. Inspect issue scope, parents, blockers, closing PRs, and existing priorities before deciding changes. Fetch repository issues and PRs missing from the project when the task includes intake; auto-add does not backfill all historical issues.

The helper saves findings and exits nonzero for inconsistent state. Review findings before writing. API matches do not prove that cards are visible. Read [operations.md](references/operations.md) for mutations, recovery, and Chrome recipes. Discover IDs on every run. View numbers and issue counts change; never use historical counts as targets.

## Default triage pass

When asked to triage or manage the board, carry the pass through edits and verification. A request for a review or proposal alone stays read-only. Use the user's authorized scope without requesting approval for every routine field update.

1. Review new or unclassified issues: the problem, desired result, acceptance checks, area labels, duplicates, and genuine dependencies. Preserve useful scope and discussion. Do not invent product decisions or estimates. Keep consequential unresolved choices in Triage with a specific question; continue independent work.
2. Accept actionable work into Backlog, or Ready with Focus = Now/Next when selected. Preserve existing batches unless delivery evidence or the user calls for changes. Keep batches coherent and prioritize blockers that unlock selected work. Decline or close duplicates only with clear evidence or user direction; retain the reason and canonical link.
3. Reconcile statuses with actual issue state, PR readiness, and acceptance evidence. A ready PR can justify In review; a draft can justify In progress. Incidental mentions, passing CI, or a partial merged PR do not establish completion. Check closing references and remaining scope. Preserve native parent/sub-issue and blocked-by relationships, including completed dependency history.
4. When Now has no unfinished work and Next is already selected, promote that batch to Now during the triage pass. Preserve dependencies: blocked tasks still wait for prerequisites. Do not preempt unfinished Now work or advance an empty batch. Replenish Next when the task includes planning and priorities justify it; otherwise report the planning gap.
5. Apply changes sequentially, update the project README if the operating contract changed, and complete API and browser verification. Summarize edits, blockers, and the useful next action.

## Board contract

Planning has **no dates**. Do not recreate cycles, iterations, deadlines, or scheduled rollover unless requested.

- **Focus**: single-select `Now` or `Next`; empty means unselected.
- **Status**: `Triage`, `Backlog`, `Ready`, `In progress`, `In review`, `Done`, `Canceled`.
- Select work by setting Focus and Ready. Start with In progress; review-ready implementation reaches In review. Defer by clearing Focus and setting Backlog.
- Completed issues are closed as completed and Done. Declined or duplicate work is closed as not planned and Canceled. Preserve Focus on closed issues for history. Re-read after closing: generic item-closed automation can overwrite Canceled with Done.
- **Priority**: P0 Urgent, P1 High, P2 Normal, P3 Low; blank means unprioritized. Use impact, urgency, and dependencies. Size and Estimate need a basis.
- **Epics** use the `epic` label and parent/sub-issue relationships. Areas use existing `area:*` labels. Epic containers are separate from ordinary delivery work.

Maintain these six views. Preserve view identities and order where possible; recreate only when in-place repair is unavailable, and report changed URLs.

| View      | Filter                                                                | Display                                                         |
| --------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| Now       | `focus:Now is:open -label:epic -status:Done,Canceled,Triage,Backlog`  | Board: Ready, In progress, In review columns                    |
| Next      | `focus:Next is:open -label:epic -status:Done,Canceled,Triage,Backlog` | Board: Ready, In progress, In review columns                    |
| Backlog   | `status:Backlog no:focus is:open -label:epic`                         | Table; keep unprioritized work visible                          |
| Roadmap   | `label:epic`                                                          | Table of epic outcomes and sub-issue progress; no timeline      |
| Triage    | `status:Triage is:open`                                               | Table; an empty queue is valid                                  |
| All items | Empty                                                                 | Table; Show hierarchy off so every issue has an independent row |

Show Focus in the planning views and All items. Preserve unrelated fields and workflows. Inspect intake, linked-PR, closed-item, merged-PR, and auto-close action mappings in the browser before claiming they work. Intended intake is Triage; Done is the completion/auto-close target. PR events must not advance Focus. Do not add automatic archival, scheduled automation, or new integrations as a substitute for triage.

## Writes and recovery

Save a before snapshot and an issue-by-issue plan outside the repository before mutations. Include expected old values, new values, reasons, and affected view settings. Apply only authorized changes. Re-read changed values immediately before applying; reconcile concurrent edits instead of overwriting them.

Record each successful write. If a write fails or its response is lost, stop the dependent sequence, inspect server state, and report the specific failure and partial changes. Do not blindly retry or recreate uncertain issues, fields, or views. Resume from observed state on an explicit retry. Recovery must preserve newer concurrent edits.

## Verification and handoff

Run the helper again with a fresh output path. Each active ordinary issue belongs to exactly one of Now, Next, Backlog, or Triage. Closed work remains in All items; epics remain in Roadmap. Report exceptions and cross-repository items without silently moving or deleting them. Compare IDs, issue content, relations, priorities, and workflows with the before snapshot for unintended changes.

Inspect affected views in an authenticated browser; inspect all six for a full-board request. Prefer the host's collaborative browser when available. Honor a Chrome/Playwright request by attaching through the Playwright extension; a fresh logged-out browser cannot verify this private board. Use the reference's commands.

Check real cards and rows. At narrow widths, empty Triage and Backlog columns can push Ready offscreen. In All items, hierarchy can collapse child issues and conceal most of the inventory. Save filters **and** display options, confirm GitHub's save dialog, and reopen the base URL without temporary query parameters to prove persistence.

If browser authentication is unavailable, report visual verification as blocked. Never request or print cookies or API tokens. Leave the user's browser open and detach only your automation connection.

Finish with edits, current Now/Next selections, blockers or unverified automation mappings, and checks actually performed. The skill runs when invoked; recurring maintenance requires a separate request.
