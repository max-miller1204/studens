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

Run `npm run verify -- browser --artifacts /tmp/studens-settings-browser`.
The settings fixture covers preference/config preservation, reload, default and custom model choices, a change during active work, unavailable-model errors, explicit retry, stale saves, restart, and 375px layout. Its nested-error probe checks literal HTML, exact original details, and refresh preserving the open details. Inspect `browser/settings/` screenshots, `settings-state.json`, and `NOTES.md`. It uses fixture teachers, so it does not prove account access.

The connection check saves a port distinct from the original listener and requires
the listener to remain on that exact original port. Inspect `settings-ports.json`
for original, requested, saved, and current ports; `settings-state.json` also retains
the original and requested values.

Run `npm run verify -- settings claude --artifacts /tmp/studens-settings-claude`, then `npm run verify -- settings codex --artifacts /tmp/studens-settings-codex` for actual selection. These use the shared fixed verification defaults, then deliberately select Claude `sonnet` or Codex `gpt-6.1-sol` from the discovered catalog. They record both requested and resolved models. A missing choice or unavailable model fails; no replacement is selected. The drives change the selection while the first request runs, finish a turn on the new model, restart the persistent service, submit an unavailable custom ID, and explicitly retry with the configured default. Inspect `settings-<host>/settings-report.json`, screenshots, `classroom/`, and `service.log`. The unavailable Codex captures include desktop, 375px mobile, and expanded details; compare the details text with the saved failed request. The original grade and conversation identity must stay unchanged.

The real Pi target's lifecycle drive opens the persistent model selector, uses an unavailable exact `provider/model` ID, verifies the durable error and the lack of automatic retry after selecting the configured default, and retries from the lesson. It checks the SDK-selected model and separate conversation survive reconnect and restart. The Pi label reports SDK selection; provider-resolved identity is not independently verified. Inspect `pi/lifecycle/pi-unavailable.png`, `lifecycle.json`, and the saved private Pi session. Successful selection of an alternate Pi model remains outside this drive; no replacement is used when a requested model fails.

For real tailnet changes, follow the tailnet prerequisites in the feature index. The phone target now also disables and enables links through the settings page. It verifies route removal/restoration before opening again from the agent, then checks explicit service-stop cleanup and unchanged unrelated routes. Inspect `phone/settings-tailnet-disabled.png`.

## Gotchas

Model catalogs describe choices; a completed inference turn establishes access for that request. Claude aliases can resolve to a different full model ID. Codex uses the RPC model value, which may differ from the catalog row ID. Global CLI settings must not be edited by these drives. A saved model change does not retry a failed request or replace a saved plan. A failed status refresh stops until Reload settings. Settings error recovery uses Reload settings, Reload models, or another explicit save; there is no automatic fallback.
