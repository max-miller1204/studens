# Development

[Documentation](README.md)

```sh
npm ci
npm run verify
```

`verify` checks release versions, formatting, types, automated tests, and isolated
browser checks. It prints an evidence directory containing logs, exit codes, screenshots, and saved
state. Use [verify-studens](../.agents/skills/verify-studens/SKILL.md) to select
additional checks for changed host behavior. Run `claude plugin validate .` after
manifest changes. Run this checkout with `pi -e .` or `claude --plugin-dir .`.

## Release versions

```sh
npm run version:bump -- 0.12.0
npm run version:check
```

Pass an exact SemVer version, including a prerelease such as `0.12.0-beta.1` when
needed. The bump command synchronizes `package.json`, both root version fields in
`package-lock.json`, and `.codex-plugin/plugin.json`. It leaves dependency records
unchanged and never invokes npm to regenerate the lockfile. It creates no commit
or tag. Review the diff before committing.

The check reports mismatched or missing versions and runs in CI and both the
default and `checks` verification targets. A bump can repair mismatched versions;
missing or malformed fields must be fixed before retrying.

## Select checks

```sh
npm run verify -- checks
npm run verify -- browser --artifacts /tmp/studens-browser
npm run verify -- pi --artifacts /tmp/studens-pi
npm run verify -- claude --artifacts /tmp/studens-claude
npm run verify -- codex --artifacts /tmp/studens-codex
```

Browser harnesses use the installed `playwright-cli` in headless mode. Real hosts
need signed-in model accounts and use the fixed models in the verification skill.
Checks use scratch classrooms; Codex also uses a temporary home with a copy of
`auth.json`. Cleanup removes owned sessions and scratch data and preserves reports.
Never stop the learner's shared service by port or process name.

Keep tests for contracts, boundary failures, recovery, request order, and private
file access. Use live browser checks for learner interactions. Avoid tests of fixed
wording or layout. Browser files run directly without a build; add `.d.mts` sidecars
when TypeScript imports a shared `.mjs` module.

## Mutation testing

```sh
npm run test:mutate
npm run test:mutate -- --mutate 'src/paths.ts'
```

Stryker mutates the contracts and policies listed in `stryker.config.json`, then
runs related Vitest tests. This includes paths, quizzes, grading, pretest gates,
review schedules, evidence, and authoring validation. Process launchers, storage
writes, network listeners, and browser interactions stay outside mutation scope;
their ordinary process and browser checks still run. Reports are local at
`reports/mutation/index.html` and `reports/mutation/mutation.json`.

Keep fixture storage redirection intact. Mutating process launch options can drop
the classroom environment and reach the learner's default storage; a copied source
tree alone does not isolate disk access. The service entry point requires an
explicit classroom root, and fixtures also set it for child processes.

Inspect survivors for missing assertions and boundary cases. A surviving wording
change does not justify a prose snapshot. Mutation scores describe this automated
scope; they do not measure browser behavior or real model quality. Process tests
also launch uninstrumented child runtimes, so their coverage cannot all be attributed
to individual tests by the Vitest mutation runner.

For teaching quality, use the authoring, feedback, and quality targets in the
verification skill. Mechanical checks set their verdict; semantic judgments are
reported separately. Read every finding and preserve failed reports. See
[evaluation](EVALUATION.md) for human retention and transfer studies.
