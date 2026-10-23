# Legacy review verification

Synthetic scratch classrooms only. Before: v0.12.0 commit 6f622b99bdce496328af8a2594542dd09c90a017. After: fix/legacy-review-spacing-pools working tree, production patch in implementation.diff.

1280×800 viewport, full-page captures. Each source has a fully correct historical answer two days earlier without learning context. New private variants use exact closed grading. The browser starts a review, answers with reported assistance, reloads, and restarts the owned loopback server. No model inference.

Before/short stays due after an independent correct answer; after/short spaces it by about 7.09 days after feedback. Both retain unknown objective context and one grade. Before/numeric rejects the original prose rubric; after/numeric publishes and completes. Assisted and unknown answers retain the original due date. Malformed variant expected keys fail before publication. JSON includes exact submitted/feedback/due timestamps and saved grades; all content is synthetic.

Base contracts reproduce the two expected failures; after contracts pass 76/76.
