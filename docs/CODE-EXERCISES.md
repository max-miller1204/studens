# Runnable JavaScript questions

[Documentation](README.md)

Use `data-type="code"` for implementing a **synchronous JavaScript function**.
Read the complete markup and limits in [quiz.html](../assets/templates/quiz.html).
Python, TypeScript, Node, browser APIs, imports and asynchronous results are not
supported. Choose another response type when the task needs them.

Each question has one labelled `textarea.cl-code-source` with starter source and
a quoted `data-code` JSON attribute:

```json
{
  "version": 1,
  "language": "javascript",
  "entry": "total",
  "tests": [
    { "id": "empty", "args": [[]], "expected": 0 },
    { "id": "mixed", "args": [[2, -1, 4]], "expected": 5 }
  ]
}
```

HTML-escape the attribute and starter source. Tests use finite JSON arguments
and expected outputs, compared structurally. Object key order does not matter;
array order does. Each test starts from fresh source and VM globals. No executable
test strings are accepted. The examples and expected results are **public**,
including in page source. They help the learner debug; keep the implementation
solution, scoring rubric, declared criteria, and unused review variants private.

Run and Stop stay on the lesson page. Editing invalidates prior results and
terminates an active run. Errors, stopped runs and timeouts need an explicit new
Run. Runs create no submission, grade, teacher request, review item or learning
evidence. Normal quiz drafts save source only. Submit saves its exact source,
authored public input/test contract, and any current bounded run snapshot with
the ordinary immutable attempt. Grading and reload lock the editor and runner.

Declare `assessmentContract: 1` and `criterionContract: 1` in lesson metadata.
Write an ordinary private teacher-judgment rubric with specific criteria and
partial credit. Code cannot use `grading: "exact"`. Teachers assess the saved
source without executing it on the host. Browser results are untrusted context:
even internally consistent fabricated passes cannot grant points. Existing exact
question allocations remain code-owned, including in mixed quizzes and regrades.
Public tests and the private rubric cannot change between attempts.

Code questions work in checks, pretests and private review variants. The latter
use the same public attribute and labelled editor, with private judgment criteria.
Ungraded `.cl-practice` continues to support its existing exact answer types; it
does not support code. The packaged checker validates private code contracts,
executes a disposable answer, verifies syntax-error feedback and restores starter
source, without submitting learner work. Its receipt binds the ordinary private
input hashes.

The pinned [QuickJS distribution](../assets/runtime/vendor/quickjs/README.md)
loads lazily after Run. It uses an isolated WASM interpreter in a disposable
worker. The guest receives no browser/DOM/origin, network, filesystem, storage,
module-loader, message-port or host-function authority. This boundary is the VM,
not removal of properties from a normal worker global. The engine bounds guest
allocation to 16 MiB, stack to 256 KiB and execution to two seconds per run. A
separate ten-second worker watchdog also covers startup and unresponsive native
operations; Stop terminates the worker immediately. Source and console output
are each bounded to 8,000 and 8,192 characters respectively. The browser and local
lesson service need the packaged assets, with no Internet access or CDN required.

Verification uses real browser execution. Server-side tests validate contracts
and persistence and never execute learner source. See the
[quiz recipe](../.agents/skills/verify-studens/features/quizzes.md) and
[evaluation protocol](EVALUATION.md) for the distinction between working software,
model adherence and human learning evidence.
