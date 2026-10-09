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

## Deploy / redeploy (from GitHub)

The Docker image builds the frontend itself (two-stage `Dockerfile`), so no local build or file copying is needed.

Every update, on the server (`ssh shangrila002@100.94.204.57`):
```
cd ~/orgchart
cp data/orgchart.db data/orgchart.db.bak-$(date +%F)    # back up first (project rule)
git pull
docker compose up -d --build
curl -s -o /dev/null -w "%{http_code}
" http://127.0.0.1:8010/api/public/chart?company=1   # 200
```

One-time setup, replacing the old copied folder (keeps the live database and uploads in `data/`):
```
cd ~ && mv orgchart orgchart-old
git clone https://github.com/it-sla/orgchart.git orgchart
mv orgchart-old/data orgchart/data
cd orgchart && docker compose up -d --build
docker compose exec -it orgchart python main.py create-admin <username>   # first admin, once
```
Delete `~/orgchart-old` and run `docker image prune -f` once the new container works: the old image and folder still hold a copy of the database. If the repo is private, give the server a deploy key or token.

Check the image has no databases: `docker compose run --rm --no-deps --entrypoint sh orgchart -c 'find /app -name "*.db*" -o -name "*.bak*" -o -name "*.log"'` should print nothing.

Logs: `docker logs orgchart`. Restart: `docker restart orgchart`. Stop: `docker compose down` (data is kept; never delete `data/`).

## Sign-in and roles (added 2026-10-09 after the pre-deployment audit)

- Every `/api` and `/uploads` request needs a signed-in session (cookie + CSRF token). Roles: **viewer** (read + export), **editor** (edit), **admin** (all companies, hard delete, add companies, users).
- First admin, on the server after redeploy: `docker compose exec -it orgchart python main.py create-admin <username>` (prompts for a 12+ character password). Other users: admin calls `POST /api/users` (no Users page yet).
- Set `ORG_COOKIE_SECURE=1` when served over HTTPS. Docker image now contains only `main.py`, `security.py`, `pdf_export.py` (see `.dockerignore`); the old image still holds a database copy, so rebuild and remove it.
- Employee `PUT` is partial and takes an optional `revision` (409 on stale).

## Public landing page and /admin (added 2026-10-09)

- `/` is a read-only showcase (Radial / Tree / Grid, photo-first, Framer Motion). It needs no sign-in and only calls `GET /api/public/companies` and `GET /api/public/chart?company=<id>` (name, role, department, photo, reporting line, board flags; no admin fields). Photos under `/uploads/` are public.
- `/admin` is the sign-in + management app. Every other `/api` route needs a session. Sign-in is **on by default** (`ORG_AUTH=1`); `ORG_AUTH=0` turns it off for private/local use only.
- Lost password: `docker compose exec -it orgchart python main.py reset-password <username>`.
- Code: `frontend/src/PublicView.tsx` + `public.css`; routing is a pathname check in `main.tsx`.

## Board of Directors rules (added 2026-10-09)

- Tick **Board member** on the Employees page to put someone in the Board of Directors box on the chart.
- A board member who **reports to nobody** shows **only** in the board box (not as a separate card). Done in `buildLayout` (`chartLayout.ts`) and in `export_pdf` (`main.py`); keep the two in sync.
- Order of the box = `board_order`, lowest first, ties alphabetical. Set it in the **"Board of Directors order"** panel at the top of the Employees page (up/down arrows, renumbers 1..n). It is not "Display order" (that only orders people within the chart/list).
- PDF export (chart styles) shows the company logo top-left in the header.

## Current state of the data

- 65 employees. As of 2026-10-08 **no "Reports to" was set** on the server copy (cleared on request); it may have been re-entered since, so check the Employees page. Board ranks on the server also need setting with the new panel.
- Departments: Admin, Customer Support, Finance, IT, Marketing, Operations, Sales. No employees are assigned to a department yet.
- Assign both from the Employees page: each card has Department and Reports to dropdowns that save immediately.
- Pre-change backups on this PC (not in git): `backend/orgchart.db.bak-before-clear-reports` (has the old reporting lines), `backend/orgchart.db.bak-departments`, `output/backups/`.

## Code layout

- `backend/main.py`: all API routes, models, SQLite setup. DB path from env `ORG_DB`.
- `backend/pdf_export.py`: PDF export. `backend/test_api.py`: tests (use an isolated test DB, not the real one).
- `frontend/src/App.tsx` (Employees, settings), `OrgChart.tsx`, `Departments.tsx`, `chartLayout.ts` (shared layout positions; PDF export uses them), `api.ts`.
- Rules for UI/departments are in `AGENTS.md` (portrait radial layout, archive-by-default delete, one "Designation / role" field).

## Open items

1. **Git**: `origin` = https://github.com/it-sla/orgchart.git. The three 2026-10-09 commits (board rules, board order panel, PDF logo) are deployed but **not yet pushed**: run `git push`.
2. **No authentication.** Consider a shared edit password or view-only mode for other devices.
3. **Reporting lines** need to be re-entered (see above), or restored from the backup file.
4. Give the server a fixed LAN address (DHCP reservation) so the URL stops changing.
5. Stop the old PC copy once everyone uses the server.
