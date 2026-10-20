# Classroom settings

Edit learner preferences, connection settings, and the model for a persistent classroom teacher.

## Sub-features

- Keep pace, depth, and tone in NOTES.md without replacing other preferences or its index.
- Validate local and tailnet ports; preserve unrelated configuration and routes.
- Apply tailnet link changes on save; keep the current local listener until an explicit restart.
- Discover teacher models from the installed host, including configured and custom IDs.
- Separate the requested setting from the model that actually answered; refresh status without replacing unsaved fields or save revisions.
- Apply model changes between requests, preserve the conversation on restart, and require an explicit retry after a model error.
- Show the specific Codex host rejection first, with request context and the complete saved error in Technical details. Keep details open across status refresh and render error markup as text.
- Reject stale saves from another page and retain fields being edited while the model catalog loads.
- Keep Pi's dedicated model selection independent of initiating chat.

## How to get to it (user POV)

1. Open a classroom and select Settings beside Review history.
2. Edit Pace, Depth, or Tone and select Save preferences.
3. For Pi, Claude, or Codex, choose Teacher model or Custom model ID… and select Save teacher model.
4. Return to the lesson and send a reply. Reopen Settings to read Last answering model separately from Requested setting.
5. After a failed model request, choose a model in Settings, then use Retry request on the lesson.
6. Save connection settings to apply links. Stop and restart the server explicitly to apply a local port change, then get its new link from the agent.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-settings-browser`. The fixture
covers preference preservation, default and custom models, a change during active
work, unavailable-model errors, explicit retry, stale saves, restart, nested error
details rendered as text, and 375px layout. A saved port change must leave the
listener on its original port. Inspect `browser/settings/`, `settings-state.json`,
`settings-ports.json`, and `NOTES.md`.

For real model selection, run `npm run verify -- settings claude --artifacts
/tmp/studens-settings-claude`, then the same for `codex`. These select Claude
`sonnet` or Codex `gpt-6.1-sol`, switch during a running request, restart, submit an
unavailable custom ID, and retry with the default. Inspect
`settings-<host>/settings-report.json` and `service.log`. The original grade and
conversation must not change.

The real Pi lifecycle drive selects an unavailable `provider/model`, confirms no
automatic retry, and retries from the lesson. Inspect `pi/lifecycle/pi-unavailable.png`.
The Pi label reports the SDK selection, not provider routing.

The `phone` target also toggles tailnet links from this page; inspect
`phone/settings-tailnet-disabled.png`.

## Gotchas

- A catalog lists choices. Only a completed turn proves access.
- Claude aliases and Codex RPC values can differ from catalog IDs.
- Drives must not edit global CLI settings.
- Saving a model does not retry a failed request. Recovery uses Reload settings,
  Reload models, or another explicit save.
