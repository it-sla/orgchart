# Handover: Shangrila Org Chart

Employee org chart with departments, reporting lines, and PDF export.
FastAPI + SQLite backend, React/Vite frontend. No login (anyone who can reach it can edit).

## Where it runs

| What | Where |
|---|---|
| **Production (use this)** | Server `shangrila002@100.94.204.57`, folder `~/orgchart`, Docker container `orgchart` |
| LAN address | http://192.168.101.244:8010/ (may change if the router reassigns it) |
| Tailscale address | http://100.94.204.57:8010/ |
| Old local copy | This PC, http://192.168.101.224:8010/ (`run.ps1`). **Separate database. Stop it** so nobody edits the wrong copy. |

The server also hosts Customer 360 and other apps. Port 8010 and the `orgchart` container are the only things this project uses.

## Data

- Server database: `~/orgchart/data/orgchart.db`; uploads (logo, photos): `~/orgchart/data/uploads/`.
- These are mounted into the container, so rebuilding or redeploying never touches them.
- The server copy was seeded from this PC on 2026-10-08 and the two have not synced since.
- Back up before schema changes (project rule). Example:
  `ssh shangrila002@100.94.204.57 'cp ~/orgchart/data/orgchart.db ~/orgchart/data/orgchart.db.bak-$(date +%F)'`
- Do not commit databases, backups, logs, or screenshots (excluded in `.gitignore`).

## Redeploy after a code change

1. Build the frontend: `cd frontend && npm run build`
2. Copy `backend/main.py`, `backend/pdf_export.py`, `backend/requirements.txt`, `frontend/dist`, `Dockerfile`, `docker-compose.yml` to `~/orgchart` on the server. **Do not overwrite `~/orgchart/data`.**
3. On the server: `cd ~/orgchart && docker compose up -d --build`
4. Check: `curl http://127.0.0.1:8010/api/employees`

Logs: `docker logs orgchart`. Restart: `docker restart orgchart`. Stop: `docker compose down` (data is kept; never delete `data/`).

## Current state of the data

- 65 employees. **No "Reports to" is set for anyone** (cleared on request on 2026-10-08). The chart shows everyone at the top level until managers are reassigned.
- Departments: Admin, Customer Support, Finance, IT, Marketing, Operations, Sales. No employees are assigned to a department yet.
- Assign both from the Employees page: each card has Department and Reports to dropdowns that save immediately.
- Pre-change backups on this PC (not in git): `backend/orgchart.db.bak-before-clear-reports` (has the old reporting lines), `backend/orgchart.db.bak-departments`, `output/backups/`.

## Code layout

- `backend/main.py`: all API routes, models, SQLite setup. DB path from env `ORG_DB`.
- `backend/pdf_export.py`: PDF export. `backend/test_api.py`: tests (use an isolated test DB, not the real one).
- `frontend/src/App.tsx` (Employees, settings), `OrgChart.tsx`, `Departments.tsx`, `chartLayout.ts` (shared layout positions; PDF export uses them), `api.ts`.
- Rules for UI/departments are in `AGENTS.md` (portrait radial layout, archive-by-default delete, one "Designation / role" field).

## Open items

1. **Git**: source, `Dockerfile`, `docker-compose.yml` and this file are committed on `main` and pushed to `origin` = https://github.com/it-sla/orgchart.git.
2. **No authentication.** Consider a shared edit password or view-only mode for other devices.
3. **Reporting lines** need to be re-entered (see above), or restored from the backup file.
4. Give the server a fixed LAN address (DHCP reservation) so the URL stops changing.
5. Stop the old PC copy once everyone uses the server.
