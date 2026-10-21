# Roll back private assessment and review state

[Documentation](README.md)

Criterion grading adds private `rubricCriteria` snapshots to submissions and saved
criterion allocations to grades and teacher plans. **Do not point published v0.11.6 or older
code at a root that has been used by criterion-enabled code.** Its
`publicSubmission()` spreads unknown fields, so even a pending attempt can expose
the snapshot through learner state. Static file guards do not protect an API
projection. The older published release cannot be repaired retroactively. Published v0.11.6
already redacts private `earlyReviewKeys` selection snapshots; v0.11.5 and older
also expose that field on a blind downgrade from review-controls data. Preserve
both fields and the complete review controls, options, evidence and history in the
newer backup. A version label alone does not establish projection compatibility.

Before deployment, stop the persistent service explicitly and end every live Pi
session using this classrooms root. Confirm all owners have stopped; detaching MCP
is not stopping the service. Keep access stopped while taking a private, complete
copy of the root, including dotfiles, `.reviews`, `.teacher.json`, plans, drafts,
history, review/refill state and configuration. Record the exact installed code
commit/tag, root path, external config path, file hashes and permissions. Copy any
external configuration too. Keep backups outside all served directories, accessible
only to the owner. Verify that a disposable copy opens with the recorded code
before allowing deployment writes. A code checkpoint alone is insufficient.

## One-time format upgrade

On first start, the service upgrades the root once before it reads any classroom.
It folds live-session Pi panel history into `.teacher.json`, turns failed Pi
passage answers and unapplied earlier-format grading plans into failed requests
that need an explicit retry, and drops fields only the old bridge read. It copies
each file it changes to `.migrations/1/` under the root. Before conversion it
atomically saves the complete migration plan at `.migrations/1/.plan.json`. On an
explicit service restart, an interrupted upgrade reapplies that saved plan without
reclassifying partially converted requests or running a teacher. Backups and the
final `.studens-format.json` marker use atomic replacement too. Temporary partial
writes are replaced on restart. Keep the plan and backups private and intact; the
format marker prevents replay after normal service work begins.

It changes nothing and stops with a specific error while unfinished live-session
Pi work or a legacy Pi tailnet route remains. Finish or explicitly retry that work
with the previous package and stop its server first. A root that records a newer
format refuses to start rather than guess.

The `.migrations/1/` copies are a record, not a rollback. Restore the complete
pre-deployment backup below instead of copying them back over a newer root.

## Returning to the previous release

To return to the previous published release:

1. Stop all service and live Pi owners again. Do not serve the newer data with older
   code, even briefly.
2. Retain a second complete private backup of the current root and configuration.
   Verify its hashes. Keep the deployed code commit available with this backup.
3. Select a **separate restored copy** of the complete pre-deployment backup and its
   matching configuration. Do not overlay it onto the newer root: new files left
   behind would defeat the restore. Preserve the newer root untouched.
4. Start the recorded older code with the restored root. Check loopback ownership,
   settings, an existing grade/history, learner-state projections and private route
   refusal before restoring access. Preserve unrelated Tailscale routes; never
   enable Funnel.

This returns all classroom state to the backup time. Work since that backup is
retained only in the private newer root and is unavailable in the older runtime.
Do not merge its submissions, grades, plans or requests into the old root. Resuming
that work requires stopping the old owners, selecting the complete newer root with
criterion- and review-compatible code and its matching configuration, then checking recovery.
Do not run both copies concurrently or replay the same external conversation in
both. Model conversation history outside the root is not reverted by a filesystem
backup; resuming teacher work across this boundary requires separate review.

To retain newer work online, use a reviewed compatible code revision that keeps
both criterion and early-review snapshot redaction, saved allocation validation, plan validation/recovery,
model snapshots and grade idempotency. Reverting only presentation is possible;
blindly reverting the storage/service contracts is not. Removing `rubricCriteria` or `earlyReviewKeys`
from canonical files, flattening criterion grades, or rewriting historical totals
is not a supported rollback. There is no automatic data downgrade.

The deployment owner must choose the acceptable state boundary and keep both
backups. A later release checkpoint does not make an older code/data pair
compatible with newer durable fields.
