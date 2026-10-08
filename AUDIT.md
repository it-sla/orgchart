# Organization chart review

## Implementation update

The first three implementation steps were completed after this review:

1. API names are trimmed and validated; uploaded images are decoded, resized, and normalized, with bounded reads and image-reference checks. Forms prevent repeat submissions and defer uploads until Save. Pages and person details have loading/error/retry states, and the details panel remains closeable. Employee dialogs protect unsaved changes and exclude descendants from manager choices.
2. Employee management now uses responsive cards with search, status/board/role/manager filters, sorting, and 15-person pagination. Settings and modal forms fit their container. Details reserve space on desktop and use a lower panel on narrow screens.
3. PDF export explicitly offers Full organization or Currently displayed people, A4/Letter, and portrait/landscape. It generates selectable vector text and paginated hierarchy cards, independent of canvas zoom and collapsed branches for full exports. Download feedback includes a reusable download link; blob URLs are released on replacement/unmount.

Validation: production build passed; eight backend tests passed using a temporary database and temporary upload directory. Browser checks covered search, board filtering, restricted manager choices, blank-name feedback, settings layout, and failure/retry behavior. The 65-person full export spans 10 A4 pages, contains every employee name, and all pages were rendered and visually reviewed. Saved employee rows remained unchanged. Historical findings below are retained as the original review; the changes above supersede the corresponding entries.

Reviewed 7 October 2026. Source review covers all application files, the launch script, and the existing backend test. Browser review covers the chart, employee table, add form, company settings, search, branch expansion, and employee details. Additional API probes ran against a temporary database and temporary upload directory, leaving saved employee data unchanged.

## Checks and current data

- TypeScript checking and production build passed.
- Existing backend suite: 1 test passed. It exercises hierarchy traversal, self-report and cycle rejection, board membership, deactivation, and inactive-manager rejection.
- Current chart: 65 active employees, 2 board members, 1 top-level employee. All active employees have designations; none has an assigned photo. Image files exist in uploads, but that does not establish who they belong to.
- PDF export was triggered, but a completed downloaded file and its visual contents were not verified. Treat export quality as unverified.
- No Git repository was found in the project directory.

## Bugs and reliability gaps

| Priority | Finding | Evidence and consequence | Suggested correction |
| --- | --- | --- | --- |
| High | Empty employee names are accepted | Temporary API probes returned 201 for both an empty name and a whitespace-only name. `backend/main.py:58` has no trimming or minimum-length validation. These records are unusable in search and the chart. | Trim names and require a nonempty value in both UI and API. Set reasonable length limits. |
| High | Invalid files are accepted as images | A plain-text payload named `fake.png` returned 200. `backend/main.py:219` checks the filename extension only. Broken images can be saved and later break logo export. | Decode and validate image content, dimensions, and size; reject invalid files before saving. |
| High | Data-loading failures have no recovery UI | `frontend/src/OrgChart.tsx:294` and the page-loading effects in `frontend/src/App.tsx` have no catches. A failed request can leave Loading, an empty employee table, or a blank settings page indefinitely. | Add visible error states with Retry, plus loading and empty states. |
| High | Failed profile loads leave an uncloseable blank panel | `frontend/src/OrgChart.tsx:148` has no catch; the early return at line 153 omits the close button. | Keep a close button available during loading and failure; show an error and retry. |
| Medium | Logo export can hang on a broken image | The `imgSize` promise in `frontend/src/OrgChart.tsx` has `onload` but no `onerror`. The API also accepts nonexistent image references; a temporary settings probe confirmed this. | Reject nonexistent references and implement fetch/image errors and a timeout. |
| Medium | Photo uploads can overwrite unrelated edits | Employee photo replacement sends the entire employee object captured in the table via PUT (`frontend/src/App.tsx:83`). A concurrent edit to the manager, designation, or status can be overwritten. | Add a photo-specific PATCH or optimistic version checks. |
| Medium | Repeated Save can create duplicates | The employee form has no pending state or disabled Save button (`frontend/src/App.tsx:14`). | Disable submission during saving and show progress and errors. |
| Medium | Forms can discard unsaved work | Clicking the modal backdrop immediately closes it (`frontend/src/App.tsx:24`). Uploaded images are written before Save and remain even after Cancel. | Protect dirty forms and manage temporary/orphan uploads. |
| Medium | Selected cards can be covered by the details panel | The chart centers the person in the full canvas (`frontend/src/OrgChart.tsx:225`), while the absolute-positioned panel overlays the right side. Narrow screens show the panel instead of the selected card. | Reserve panel space on desktop and use a bottom sheet or distinct details screen on narrow layouts. |
| Medium | Settings and employee management need responsive layouts | Narrow-panel screenshots show horizontal overflow in the employee table and settings form. `.form` uses a fixed 440px width with viewport-based maximum width rather than parent-based width. | Constrain the settings form to its container; use employee cards or a dedicated scroll region with accessible actions. |
| Medium | Settings allow a blank company name | Temporary API probe returned 200 for an empty company name (`backend/main.py:69`). | Trim and validate the name server-side as well as in the form. |
| Low | Export blob URLs are never released | `frontend/src/OrgChart.tsx:251` creates object URLs without revoking them. | Revoke each URL after the download is initiated safely. |
| Low | Startup can continue after a failed build | `run.ps1` does not check npm's exit code before launching the backend. It can serve an old build. | Stop on failed build and provide explicit startup diagnostics. |

## Missing usability and product features

1. **Employee directory search, filters, sorting, and pagination.** The chart has search, but the employee page renders every row without these controls. Add active/inactive, role, board, and manager filters.
2. **Export scope and print layout.** Export currently captures only the displayed nodes, so collapsed branches are omitted. Offer Current view versus Full organization, paper sizes, landscape/portrait, and readable multipage output. Label the current behavior clearly.
3. **Backups, restore, and change history.** No application backup/restore, undo for reporting changes, or audit log exists. Deactivation moves reports to the manager above; reactivation does not restore the previous structure.
4. **Bulk import and structured data export.** No CSV/Excel import, duplicate preview, bulk changes, or roster export exists.
5. **Team and department grouping.** Employees have names, designations, reporting links, photos, and ordering values, but no department/team fields or group filters. Add these only if they match the organization.
6. **Clear hierarchy context.** Add reporting-path highlighting, team totals, a visible zoom percentage, a reset-to-start control, and saved layout/collapse preferences. Search currently shows at most eight matches without a count or a way to see the remainder.
7. **Photo and logo management.** All 65 active employees currently use initials. There are uploads, but no remove-photo/remove-logo control or broken-image fallback. Existing uploads cannot be selected from a library.
8. **Accessible dialogs and search.** The modal lacks dialog semantics, focus trapping/restoration, and Escape handling. Chart search lacks combobox semantics and arrow-key result navigation. Hidden table photo inputs lack a keyboard-operable replacement control. Reduced-motion CSS does not disable React Flow's JavaScript viewport animation.
9. **Form feedback and safer hierarchy editing.** Show success feedback, upload limits, manager search, and a preview of which employees move when a manager is deactivated. Exclude descendants from manager choices rather than waiting for API cycle rejection.
10. **Navigation state.** Pages use local React state; refresh returns to the chart and browser Back cannot navigate between application pages. Add routing and meaningful URLs if this is intended for everyday use.

## Shared-use readiness

There is no authentication or authorization: any client that can reach the service can read and change employees, upload files, edit settings, and invoke permanent deletion. The currently launched server binds to loopback, but `run.ps1` binds to all interfaces for LAN access. Before using that LAN mode with shared users, introduce viewer/editor permissions and an authenticated boundary. This is a deployment gap, not evidence that the current loopback server is publicly exposed.

Dependencies are not consistently pinned: Python requirements are unversioned; the frontend has a lockfile. There is no setup guide, migration framework, structured operational logging, frontend workflow test suite, or coverage of uploads/settings/blank input/export. The existing backend test is useful but covers only one scenario sequence. The build also reports an approximately 846 KB JavaScript chunk before compression; lazy-load PDF export libraries to improve initial loading.

## Suggested implementation order

### Department CRUD follow-up completed (2026-10-07)

Added single-department read and DELETE endpoints. DELETE archives by default;
hard deletion requires an archived, empty department, counting inactive employees
too. The department UI now shows Delete for archived departments, explains blocked
deletion, and presents inline confirmation and errors. Existing employee records
are never removed as part of department deletion. SQLite foreign keys are enabled
to preserve reference integrity. Build passes and 14 tests pass, covering successful
deletion, rejected active/in-use deletion, missing records, and reusable names.
The browser confirmation was checked using an isolated test database, without
deleting live departments.

### Department management completed (2026-10-07)

Added a Departments page with unique, case-insensitive names, descriptions,
member counts, search, renaming, archiving and restoration. Employee forms now
support department assignment, and the directory supports department filtering,
unassigned filtering, and department search. Department details appear in person
panels. Designation and role remain one field, per the user's clarification;
existing titles are offered as form suggestions.

Archived departments preserve membership and block new assignments. Renaming
updates employee displays without changing membership. Older employee update
requests that omit department_id preserve the current department. An additive,
idempotent SQLite migration adds department_id without guessing assignments.
The database was backed up under output/backups before the migration, and all
original fields of all 65 employees were verified unchanged afterwards.

Validation: frontend production build passes; 13 backend tests pass, including
department lifecycle, duplicate names, assignment validation, archive rules,
backward compatibility, and legacy database migration. Browser verification of
assignment, rename, archive, restore, and filtering used an isolated database
copy on port 8011; the copy and its server are not the live app. Mobile department
and employee forms were checked. The live app remains on port 8010, with no test
departments or guessed employee assignments.

### PDF follow-up completed (2026-10-07)

Downloads now preserve the selected radial, compact, or tree layout using the
same shared frontend coordinates. Full organization expands all branches for
export; displayed-people export preserves the current collapsed layout. The
default chart-sized page keeps vector text readable at 100%, with optional
A4/Letter fit-to-page and portrait/landscape controls. Board cards, portraits,
initials, the company circle, and reporting lines are included.

Verified all three full PDFs visually and checked that all 65 names were
present. Verified displayed-people downloads in the browser, including tree
on landscape A4. Production frontend build succeeds and 11 backend tests pass.
UI/UX Pro Max guidance is recorded in AGENTS.md for future project UI changes.

### Original implementation sequence

1. Fix input/image validation, failed-load recovery, pending saves, and the blank details panel.
2. Finish responsive employee/settings layouts and add directory search/filtering.
3. Make full-organization export explicit and verify generated PDFs visually.
4. Add backup/restore and change history, then bulk import/export if needed.
5. Add access control before shared-network use; extend tests around these changes.

This review separates reproduced defects, source-derived failure paths, missing capabilities, and unverified behavior. It does not claim that every browser/OS or all large-organization cases have been tested.
