# Roll back private assessment and review state

[Documentation](README.md)

Newer releases save private fields that older code can leak. Criterion grading adds
`rubricCriteria` snapshots to submissions, and review controls add `earlyReviewKeys`.
**Never point v0.11.6 or older at a classrooms root used by criterion-enabled code.**
Its `publicSubmission()` spreads unknown fields, so learner state can expose those
snapshots even for a pending attempt. v0.11.5 and older also expose `earlyReviewKeys`.
There is no automatic data downgrade.

## Before deploying

1. Stop the persistent service explicitly and end every live Pi session on this root.
   Detaching MCP does not stop the service.
2. Copy the complete root privately, including dotfiles, `.reviews/`, `.teacher.json`,
   plans, drafts, history, and configuration, plus any external config file.
3. Record the installed commit or tag, root path, config path, file hashes, and permissions.
4. Keep backups outside served directories, readable only by you.
5. Confirm a disposable copy opens with the recorded code.

## Returning to the previous release

1. Stop the service and all live Pi owners. Never serve newer data with older code.
2. Take a second complete backup of the current root and configuration, and keep the
   deployed commit with it.
3. Restore the pre-deployment backup to a **separate** directory. Do not overlay it on
   the newer root.
4. Start the recorded older code on the restored root. Check ownership, settings, an
   existing grade, learner state, and private route refusal before restoring access.
   Preserve unrelated Tailscale routes and never enable Funnel.

This returns all classroom state to the backup time. Work since then stays in the
newer root. Do not merge it into the old root or run both copies at once. Model
conversation history outside the root is not reverted.

To keep newer work online instead, use a compatible code revision that still redacts
criterion and early-review snapshots and validates saved plans. Reverting presentation
is fine; removing `rubricCriteria` or `earlyReviewKeys` or rewriting historical
totals is not a supported rollback.
