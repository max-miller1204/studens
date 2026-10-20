# Start a review

Start a daily review from Classrooms, or a spaced review from the classroom memory
map. Reviews assemble prepared private variants without a model turn. Questions,
keys, and plan are saved before publication.

## Sub-features

- Memory map: per-objective evidence, latest answer, gaps, next due time, **Why is
  this due?**, and a fourteen-day forecast table with the shared allowance.
- Choose Quick 3 through 12 items and a topic. Opt into early review without
  extending the saved interval.
- Daily review across classrooms, one classroom group at a time, with separate history.
- Answer one card at a time with immediate closed grading and next/previous navigation.
- Continue corrective teacher questions beside the current card.
- Retire or restore items while keeping evidence and published reviews.
- Flag a bad question in the owning teacher panel.
- Refill low pools in the background with visible errors and explicit retry.
- Pause items after three unresolved misses and offer a short re-teach on the lesson page.
- Keep pools, keys, and saved documents off HTTP routes.

## How to get to it (user POV)

**Daily.** From Classrooms, read `N due across classrooms` and select `Start daily
review`. Select `Continue <classroom> review`, answer every card, then `Continue
daily review`. The next classroom starts only when earlier cards are graded. After an
error, fix its cause and select `Retry <classroom> review`.

**Single classroom.**

1. In the memory map, choose `Review size` and `Topic`, optionally enable `Review
early anyway`, and select `Start review`.
2. If publication fails, fix the cause and select `Retry review`.
3. Answer the card, submit, read feedback, and select `Next question`. A miss starts
   a corrective panel question on the same screen.
4. Reload mid-review. `Continue review` resumes with drafts and grades intact.
5. Select `Flag bad question`, describe the problem, and `Send reply`.
6. Select `Retire item` on a card or in `Manage review items`; `Restore item` undoes it.
7. Open `Review history`. Reviews stay out of Lessons.
8. For an item with three misses, select `Open short re-teach`, then `Start short
re-teach` on the lesson page.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-review-browser`. All drives
below run in the default browser suite with fixture teachers.

| Drive        | Focused command                                                                                                                                                    | Inspect                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Memory map   | `node --input-type=module -e 'import {verifyMemoryMapBrowser} from "./scripts/e2e-memory-map-browser.ts";await verifyMemoryMapBrowser("/tmp/studens-memory-map")'` | `memory-map/<owner>/result.json`, `read-only-hashes.json` |
| Review cards | `node --input-type=module -e 'import {verifyReviewCards} from "./scripts/e2e-review-cards.ts";await verifyReviewCards("/tmp/studens-review-cards")'`               | `review-cards/{pi,service}/result.json`, `*-hashes.json`  |
| Workload     | `node --input-type=module -e 'import {verifyReviewWorkload} from "./scripts/e2e-review-workload.ts";await verifyReviewWorkload("/tmp/studens-workload")'`          | `review-workload/result.json`, `root/result.json`         |
| Controls     | default suite                                                                                                                                                      | `review-controls/{pi,service}/result.json`                |
| Daily        | default suite                                                                                                                                                      | `daily-review/{pi,service}/result.json`                   |
| Publication  | default suite                                                                                                                                                      | `review/{pi,service}/result.json`                         |
| Re-teach     | default suite                                                                                                                                                      | `reteach/{pi,service}/result.json`                        |

What each drive must show:

- **Memory map.** Rows match saved-attempt replay; reads make no non-GET/HEAD
  requests and leave hashes unchanged. Malformed timing shows a specific error and
  **Retry loading review state**.
- **Cards.** Two-card order, immediate closed feedback, same-screen correction, drafts,
  duplicate-submission rejection, and fragments that keep the selected card without
  a source notice. A later-card URL cannot skip an unanswered card.
- **Workload.** 20 overdue items with 5 slots defer 15. Seven classrooms share one
  daily allowance across UTC midnight. The server clock is fixed.
- **Controls.** Quick 3 and 12, topic groups, early review keeps the original due
  date, retire/restore, and a question report that fails once and needs `Retry
request`. Changing the model alone does not retry.
- **Daily.** Separate classroom groups, partial publication conflict, explicit retry,
  one grade per card, and routing to each classroom's teacher.
- **Publication.** Zero model turns during assembly, conflict and retry, cross-host
  opening, and a failed background refill with explicit retry.
- **Re-teach.** Three saved misses pause the item; failures stay visible until retry;
  grades and miss history are unchanged.

Real host drives (`pi`, `claude`, `codex`) start through `Start daily review`, submit
a miss, receive a real corrective question, reply, and flag a question. Inspect
`stored-review.json`, `stored-daily.json`, `stored-question-report.json`, and
`<host>-review-correction.png`. Read the saved corrective task: it must ask for fresh
retrieval without giving the answer. A new check's `answeredAt` must match the
learner reply time.

For the refill protocol, run `npm run verify -- refill claude`, then `npm run verify
-- refill codex`. Each retries a saved invalid refill plan from the browser; the real
teacher must add one private variant without changing the original key or grade.
Inspect `classroom/.review-refills.json`.

## Gotchas

- Repeated clicks reuse the saved document. Recovery never calls the model or
  grades again for saved output. Interrupted model work requires explicit retry.
- Hosts cannot take over another host's unpublished work; finished reviews open
  anywhere.
- New sessions use `/c/<classroom>/reviews/<review-id>` and private `.reviews/`.
  Numbered legacy reviews keep their URLs.
- Miss counts are cumulative. Assisted or unknown-independence replies keep the
  pause; opening a re-teach never resets it.
- Daily plans live privately at the classrooms root. GET status never publishes or
  retries. A stale group selection requires explicit retry, which rechecks eligibility.
- Fixture teachers prove routing and storage, not question quality or retention.
