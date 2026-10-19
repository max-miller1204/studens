# Classroom settings

Edit learner preferences, connection settings, and the model for a persistent classroom teacher.

## Sub-features

- Keep pace, depth, and tone in NOTES.md without replacing other preferences or its index.
- Validate local and tailnet ports; preserve unrelated configuration and routes.
- Apply tailnet link changes on save; keep the current local listener until an explicit restart.
- Discover teacher models from the installed host, including configured and custom IDs.
- Separate the requested setting from the model that actually answered; refresh status without replacing unsaved fields or save revisions.
- Apply model changes between requests, preserve the conversation on restart, and require an explicit retry after a model error.
- Reject stale saves from another page and retain fields being edited while the model catalog loads.
- Keep Pi's model in its live session.

## How to get to it (user POV)

1. Open a classroom and select Settings beside Review history.
2. Edit Pace, Depth, or Tone and select Save preferences.
3. For Claude or Codex, choose Teacher model or Custom model ID… and select Save teacher model.
4. Return to the lesson and send a reply. Reopen Settings to read Last answering model separately from Requested setting.
5. After a failed model request, choose a model in Settings, then use Retry request on the lesson.
6. Save connection settings to apply links. Stop and restart the server explicitly to apply a local port change, then get its new link from the agent.

## Driving it with playwright-cli

Run `npm run verify -- browser --artifacts /tmp/studens-settings-browser`.
The settings fixture covers preference/config preservation, reload, default and custom model choices, a change during active work, unavailable-model errors, explicit retry, stale saves, restart, and 375px layout. Inspect `browser/settings/` screenshots, `settings-state.json`, and `NOTES.md`. It uses fixture teachers, so it does not prove account access.

Run `npm run verify -- settings claude --artifacts /tmp/studens-settings-claude`, then `npm run verify -- settings codex --artifacts /tmp/studens-settings-codex` for actual selection. These use the shared fixed verification defaults, then deliberately select Claude `sonnet` or Codex `gpt-6.1-sol` from the discovered catalog. They record both requested and resolved models. A missing choice or unavailable model fails; no replacement is selected. The drives change the selection while the first request runs, finish a turn on the new model, restart the persistent service, submit an unavailable custom ID, and explicitly retry with the configured default. Inspect `settings-<host>/settings-report.json`, screenshots, `classroom/`, and `service.log`. The original grade and conversation identity must stay unchanged.

The shared real Pi drive includes preference reload and connection saves on the settings page, hides the persistent model selector, and checks that settings never start a persistent service. Inspect `pi/pi-settings.png`. The broader Pi drive still checks grading, panel replies, resume, and re-teaching; report its full verdict separately if it fails after the settings steps.

For real tailnet changes, follow the tailnet prerequisites in the feature index. The phone target now also disables and enables links through the settings page. It verifies route removal/restoration before opening again from the agent, then checks explicit service-stop cleanup and unchanged unrelated routes. Inspect `phone/settings-tailnet-disabled.png`.

## Gotchas

Model catalogs describe choices; a completed inference turn establishes access for that request. Claude aliases can resolve to a different full model ID. Codex uses the RPC model value, which may differ from the catalog row ID. Global CLI settings must not be edited by these drives. A saved model change does not retry a failed request or replace a saved plan. A failed status refresh stops until Reload settings. Settings error recovery uses Reload settings, Reload models, or another explicit save; there is no automatic fallback.
