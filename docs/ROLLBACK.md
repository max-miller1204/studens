# Roll back criterion grading

[Documentation](README.md)

Criterion grading adds private `rubricCriteria` snapshots to submissions and saved
criterion allocations to grades and teacher plans. **Do not point v0.11.5 or older
code at a root that has been used by criterion-enabled code.** Its
`publicSubmission()` spreads unknown fields, so even a pending attempt can expose
the snapshot through learner state. Static file guards do not protect an API
projection. The older published release cannot be repaired retroactively.

Before deployment, stop the persistent service explicitly and end every live Pi
session using this classrooms root. Confirm all owners have stopped; detaching MCP
is not stopping the service. Keep access stopped while taking a private, complete
copy of the root, including dotfiles, `.reviews`, `.teacher.json`, plans, drafts,
history, review/refill state and configuration. Record the exact installed code
commit/tag, root path, external config path, file hashes and permissions. Copy any
external configuration too. Keep backups outside all served directories, accessible
only to the owner. Verify that a disposable copy opens with the recorded code
before allowing deployment writes. A code checkpoint alone is insufficient.

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
criterion-compatible code and its matching configuration, then checking recovery.
Do not run both copies concurrently or replay the same external conversation in
both. Model conversation history outside the root is not reverted by a filesystem
backup; resuming teacher work across this boundary requires separate review.

To retain newer work online, use a reviewed compatible code revision that keeps
criterion snapshot redaction, saved allocation validation, plan validation/recovery,
model snapshots and grade idempotency. Reverting only presentation is possible;
blindly reverting the storage/service contracts is not. Removing `rubricCriteria`
from canonical files, flattening criterion grades, or rewriting historical totals
is not a supported rollback. There is no automatic data downgrade.

The deployment owner must choose the acceptable state boundary and keep both
backups. A later release checkpoint does not make an older code/data pair
compatible with newer durable fields.
