# Project UI guidance

Use the installed UI/UX Pro Max skill for UI work throughout this project:
`C:/Users/ssrs/.codex/skills/ui-ux-pro-max/SKILL.md`.
Upstream: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill

Preserve the user's portrait-based radial reference, with blue nameplates,
a central company circle, and clear reporting lines. Compact and tree remain
alternative layouts. PDF downloads must preserve the selected layout, using
the shared `frontend/src/chartLayout.ts` positions rather than reconstructing
the chart as a list. Keep full-organization and displayed-people export scopes.

Use labeled, keyboard-accessible controls, responsive layouts, clear pending
and error states, and reduced-motion support. Verify UI changes locally and
render exported PDFs for visual inspection. Keep tests isolated from the real
employee database.

Departments are a separate managed entity. Designation and role mean the same
thing in this project; keep one `designation` field labeled "Designation / role".
Do not invent department assignments for existing employees. Archived departments
retain memberships, cannot receive new assignments, and can be restored. Preserve
existing database records through additive, idempotent migrations and back up
the real database before schema changes.

Department DELETE archives by default, matching employee deactivation. Permanent
department deletion requires an archived department with zero assigned employees
(including inactive employees); enforce this on the server as well as in the UI.
