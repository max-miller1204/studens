# App navigation and Today

Move between classrooms, folders, search and review, and resume reading from Today.

## Sub-features

- Top bar, sidebar landmarks, current location and skip link.
- Today lists all classrooms, then folders; daily review keeps its existing start/history controls.
- Continue the most recently visited unfinished lesson on this device at its saved heading or passage anchor.
- Lesson pages default to a 48px rail; expansion is remembered on this device.
- At phone widths, open a contained drawer with keyboard focus trapping and Escape focus return.
- Change the accent from the sidebar and keep Settings synchronized.
- Show navigation read errors and require explicit retry.

## How to get to it (user POV)

1. Open the root Today page.
2. Use the sidebar to open a classroom, folder, Review or Search; top-bar Search works on phones too.
3. Open a lesson, expand or collapse its rail, and reload.
4. Read further into a lesson, return to Today, and select `Continue lesson`.
5. On a phone, select `Open navigation`. Tab through the drawer and press Escape to close it.
6. Use `Sidebar accent`, or open Settings and select `Accent`.

## Driving it with playwright-cli

Run `node --input-type=module -e 'import {verifyNavigationBrowser} from "./scripts/e2e-navigation-browser.ts";await verifyNavigationBrowser("/tmp/studens-navigation")'`.
The default browser suite includes the same drive. It creates scratch classrooms,
a due item, a folder, and an unfinished reading lesson. Inspect `result.json`, the
Today/lesson screenshots at 1280px and 390px in both themes, drawer screenshots,
and `drawer.webm`.

The drive opens Review and returns through Today, then follows the Main navigation classroom link into a lesson, checks the
48px default, uses Enter to expand, and reloads both saved rail states. It scrolls
to a named heading, leaves through the brand link, and follows `Continue lesson`
back to the reading passage’s exact public anchor. It also visits a plain lesson in another classroom and resumes its generated public passage anchor. It checks Today current-page state and a due badge, hides a redundant classroom breadcrumb, and keeps the course-map breadcrumb visible. It opens and closes the daily-review details disclosure.
The phone drawer focuses Close, wraps Tab and Shift+Tab, returns focus after Escape,
and becomes inert when closed. Resizing an open drawer to desktop restores focus to the content. It opens a folder through the drawer. Reduced motion
uses opacity without translation and preserves contained overscroll. A failed
navigation fetch names its error and reloads only after `Retry loading navigation`, retaining keyboard focus.
The sidebar accent survives reload and synchronizes with Settings in both directions.
Sidebar Search opens the search page; top-bar Search also opens by keyboard. A legacy lesson without a main element keeps sidebar selection out of Ask, saves one real prose question with an empty anchor prefix, and retains its public resume anchor. No page errors or horizontal overflow are allowed.

Use [folders](folders.md) for movement, [review](review.md) for real review start and
publication, and [reading](reading.md) for lesson interactions. The default suite
also runs appearance checks across every accent and both themes.

## Gotchas

Continue history and rail preference are local to the browser/device. A lesson
with a saved non-pretest grade is excluded unless an attempt remains ungraded;
reviews and unpublished lessons are excluded. New visitors have no Continue card.
Moving a classroom does not change its lesson URL. Folder and review load errors
retain their own page-level Retry controls; a sidebar read failure never substitutes
an empty successful navigation list. Navigation reads do not start teacher work.
