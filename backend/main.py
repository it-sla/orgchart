import datetime as dt
import os
import sys
import threading
import uuid
import io
import warnings
from pathlib import Path

import security
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from PIL import Image, UnidentifiedImageError
from fastapi.responses import FileResponse, Response
from sqlalchemy import ForeignKey, create_engine, select, inspect, text, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.sql import func

BASE = Path(__file__).parent
UPLOADS = BASE / "uploads"
UPLOADS.mkdir(exist_ok=True)
engine = create_engine(f"sqlite:///{os.environ.get('ORG_DB', BASE / 'orgchart.db')}", connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def enforce_foreign_keys(connection, _record):
    connection.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class CompanySettings(Base):
    __tablename__ = "company_settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_name: Mapped[str] = mapped_column(default="My Company")
    logo_path: Mapped[str | None] = mapped_column(default=None)


class Department(Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("company_settings.id"), default=1)
    name: Mapped[str]
    # "{company_id}:{casefolded name}" so names are unique per company.
    name_key: Mapped[str] = mapped_column(unique=True)
    description: Mapped[str] = mapped_column(default="")
    is_active: Mapped[bool] = mapped_column(default=True)


class Employee(Base):
    __tablename__ = "employees"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("company_settings.id"), default=1)
    name: Mapped[str]
    designation: Mapped[str] = mapped_column(default="")
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), default=None)
    photo_path: Mapped[str | None] = mapped_column(default=None)
    # Self-reference: the ONLY place a reporting relationship is stored.
    reports_to_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"), default=None)
    is_board_member: Mapped[bool] = mapped_column(default=False)
    board_order: Mapped[int] = mapped_column(default=0)
    display_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    revision: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[dt.datetime] = mapped_column(server_default=func.now())


Base.metadata.create_all(engine)
# Additive, idempotent migration for existing SQLite installations.
def migrate_employee_fields(database_engine):
    with database_engine.begin() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("employees")}
        if "department_id" not in columns:
            connection.execute(text("ALTER TABLE employees ADD COLUMN department_id INTEGER REFERENCES departments(id)"))
        # Older databases predate these columns; without them every employee query fails.
        for column, ddl in (("is_board_member", "BOOLEAN NOT NULL DEFAULT 0"), ("board_order", "INTEGER NOT NULL DEFAULT 0"),
                            ("display_order", "INTEGER NOT NULL DEFAULT 0"), ("is_active", "BOOLEAN NOT NULL DEFAULT 1"),
                            ("revision", "INTEGER NOT NULL DEFAULT 0")):
            if column not in columns:
                connection.execute(text(f"ALTER TABLE employees ADD COLUMN {column} {ddl}"))
        # Multi-company: existing rows belong to company 1. SQLite cannot add a REFERENCES column with a
        # non-NULL default, so existing databases get a plain column (validated in code).
        tables = inspect(connection).get_table_names()
        for table in ("employees", "departments"):
            if table in tables and "company_id" not in {c["name"] for c in inspect(connection).get_columns(table)}:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN company_id INTEGER NOT NULL DEFAULT 1"))
        if "departments" in tables:
            connection.execute(text("UPDATE departments SET name_key = company_id || ':' || name_key WHERE substr(name_key, 1, length(company_id) + 1) != company_id || ':'"))


migrate_employee_fields(engine)
with SessionLocal() as _s:
    if not _s.get(CompanySettings, 1):
        _s.add(CompanySettings(id=1))
        _s.commit()


def db(request: Request, x_company_id: int = Header(1)):
    """Session scoped to the X-Company-Id company, after checking the signed-in user may use it."""
    user = request.state.user
    role = "admin" if user["is_admin"] else user["memberships"].get(str(x_company_id))
    if role is None:
        raise HTTPException(403, "You do not have access to this company")
    # Exporting is a POST but only reads data, so viewers may do it.
    if role == "viewer" and request.method not in {"GET", "HEAD"} and request.url.path != "/api/export/pdf":
        raise HTTPException(403, "Your role is view-only")
    with SessionLocal() as s:
        if not s.get(CompanySettings, x_company_id):
            raise HTTPException(404, "Company not found")
        s.info["company_id"] = x_company_id
        s.info["admin"] = role == "admin"
        yield s


def require_admin(s: Session):
    if not s.info["admin"]:
        raise HTTPException(403, "Administrator access required")


def require_editor(request: Request):
    user = request.state.user
    if not user["is_admin"] and "editor" not in user["memberships"].values():
        raise HTTPException(403, "Your role is view-only")


# Employee edits validate the hierarchy and then commit; this lock makes that one step so two requests
# cannot each validate against the old graph and together create a cycle.
# ponytail: in-process lock, valid for the single uvicorn worker in the Dockerfile; use BEGIN IMMEDIATE for several workers.
hierarchy_lock = threading.Lock()


def cid(s: Session) -> int:
    return s.info["company_id"]


class EmployeeIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=200)
    designation: str = Field(default="", max_length=200)
    department_id: int | None = Field(default=None, gt=0)
    photo_path: str | None = None
    reports_to_id: int | None = None
    is_board_member: bool = False
    board_order: int = Field(default=0, ge=-1_000_000, le=1_000_000)
    display_order: int = Field(default=0, ge=-1_000_000, le=1_000_000)
    is_active: bool = True


class EmployeePatch(BaseModel):
    """PUT body: only fields the client sends are changed; `revision` guards against overwriting newer edits."""
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    designation: str | None = Field(default=None, max_length=200)
    department_id: int | None = Field(default=None, gt=0)
    photo_path: str | None = None
    reports_to_id: int | None = None
    is_board_member: bool | None = None
    board_order: int | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    display_order: int | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    is_active: bool | None = None
    revision: int | None = None


class SettingsIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    company_name: str = Field(min_length=1, max_length=200)
    logo_path: str | None = None


class CompanyIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    company_name: str = Field(min_length=1, max_length=200)


class DepartmentIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    is_active: bool = True


def validate_image_reference(name: str | None):
    if name is not None and (Path(name).name != name or not (UPLOADS / name).is_file()):
        raise HTTPException(400, "Choose an existing uploaded image")


def emp_dict(e: Employee):
    data = {c.name: getattr(e, c.name) for c in Employee.__table__.columns}
    session = Session.object_session(e)
    department = session.get(Department, e.department_id) if session and e.department_id else None
    data["department_name"] = department.name if department else None
    return data


def validate_department(s: Session, department_id: int | None, previous_id: int | None = None):
    if department_id is None:
        return
    department = s.get(Department, department_id)
    if not department or department.company_id != cid(s) or (not department.is_active and department_id != previous_id):
        raise HTTPException(400, "Choose an existing active department")


def get_emp(s: Session, id: int) -> Employee:
    e = s.get(Employee, id)
    if not e or e.company_id != cid(s):
        raise HTTPException(404, "Employee not found")
    return e


def validate_manager(s: Session, emp_id: int | None, manager_id: int | None):
    """Reject self-reports, unknown/inactive managers, and cycles."""
    if manager_id is None:
        return
    if manager_id == emp_id:
        raise HTTPException(400, "An employee cannot report to themselves")
    m = s.get(Employee, manager_id)
    if not m or not m.is_active or m.company_id != cid(s):
        raise HTTPException(400, "Manager must be an existing active employee")
    # Walk up from the proposed manager; meeting emp_id means the manager is below the employee.
    seen, cur = set(), m
    while cur is not None and cur.id not in seen:
        if cur.id == emp_id:
            raise HTTPException(400, "Circular reporting relationship")
        seen.add(cur.id)
        cur = s.get(Employee, cur.reports_to_id) if cur.reports_to_id else None


def direct_reports(s: Session, id: int, active_only=True):
    q = select(Employee).where(Employee.reports_to_id == id)
    if active_only:
        q = q.where(Employee.is_active)
    return s.scalars(q.order_by(Employee.display_order, Employee.name)).all()


def release_reports(s: Session, e: Employee):
    """Inactive people leave the chart; their reports move up to their manager."""
    for r in direct_reports(s, e.id, active_only=False):
        r.reports_to_id = e.reports_to_id


def settings_dict(s: Session):
    c = s.get(CompanySettings, cid(s))
    return {"id": c.id, "company_name": c.company_name, "logo_path": c.logo_path}


app = FastAPI(title="Org Chart")
def company_ids():
    with SessionLocal() as s:
        return set(s.scalars(select(CompanySettings.id)))


# Sign-in is on by default (accounts and roles, see security.py). ORG_AUTH=0 is for a trusted private network or
# local development only: everyone who can reach the app then acts as an administrator.
LOCAL_USER = {"id": 0, "username": "local", "is_admin": True, "csrf": "", "memberships": {}}
if os.environ.get("ORG_AUTH", "1") == "1":
    security.install(app, engine, company_ids)
else:
    @app.middleware("http")
    async def local_user(request: Request, call_next):
        request.state.user = LOCAL_USER
        return await call_next(request)

    @app.get("/api/auth/me")
    def local_me():
        return LOCAL_USER
app.mount("/uploads", StaticFiles(directory=UPLOADS), name="uploads")


def company_employees(s: Session):
    return s.scalars(select(Employee).where(Employee.company_id == cid(s))).all()


def find_department(s: Session, id: int) -> Department:
    department = s.get(Department, id)
    if not department or department.company_id != cid(s):
        raise HTTPException(404, "Department not found")
    return department


def department_dict(department: Department, employees):
    members = [e for e in employees if e.department_id == department.id]
    return {"id": department.id, "name": department.name, "description": department.description,
            "is_active": department.is_active, "employee_count": len(members),
            "active_employee_count": sum(e.is_active for e in members)}


@app.get("/api/departments")
def list_departments(s: Session = Depends(db)):
    employees = company_employees(s)
    return [department_dict(d, employees) for d in s.scalars(select(Department).where(Department.company_id == cid(s)).order_by(Department.name_key)).all()]


@app.get("/api/departments/{id}")
def get_department(id: int, s: Session = Depends(db)):
    return department_dict(find_department(s, id), company_employees(s))


def save_department(body: DepartmentIn, s: Session, department: Department | None = None):
    name = " ".join(body.name.split())
    key = f"{cid(s)}:{name.casefold()}"
    duplicate = s.scalar(select(Department).where(Department.name_key == key))
    if duplicate and (department is None or duplicate.id != department.id):
        raise HTTPException(409, "A department with this name already exists, including archived departments")
    if department is None:
        department = Department(name=name, name_key=key, company_id=cid(s))
        s.add(department)
    department.name, department.name_key = name, key
    department.description, department.is_active = body.description, body.is_active
    try:
        s.commit()
    except IntegrityError:
        s.rollback()
        raise HTTPException(409, "A department with this name already exists")
    return department_dict(department, company_employees(s))


@app.post("/api/departments", status_code=201)
def create_department(body: DepartmentIn, s: Session = Depends(db)):
    return save_department(body, s)


@app.put("/api/departments/{id}")
def update_department(id: int, body: DepartmentIn, s: Session = Depends(db)):
    return save_department(body, s, find_department(s, id))


@app.delete("/api/departments/{id}")
def delete_department(id: int, hard: bool = False, s: Session = Depends(db)):
    department = find_department(s, id)
    if hard:
        require_admin(s)
        if department.is_active:
            raise HTTPException(409, "Archive the department before permanently deleting it")
        if s.scalar(select(Employee.id).where(Employee.department_id == id).limit(1)) is not None:
            raise HTTPException(409, "Reassign or unassign all employees, including inactive employees, before deleting this department")
        s.delete(department)
    else:
        department.is_active = False
    try:
        s.commit()
    except IntegrityError:
        s.rollback()
        raise HTTPException(409, "This department is assigned to employees. Refresh and reassign them before deleting it")
    return {"ok": True}


@app.get("/api/employees")
def list_employees(s: Session = Depends(db)):
    es = s.scalars(select(Employee).where(Employee.company_id == cid(s)).order_by(Employee.display_order, Employee.name)).all()
    return [emp_dict(e) for e in es]


@app.get("/api/employees/{id}")
def get_employee(id: int, s: Session = Depends(db)):
    return emp_dict(get_emp(s, id))


@app.post("/api/employees", status_code=201)
def create_employee(body: EmployeeIn, s: Session = Depends(db)):
    validate_image_reference(body.photo_path)
    with hierarchy_lock:
        validate_department(s, body.department_id)
        validate_manager(s, None, body.reports_to_id)
        e = Employee(**body.model_dump(), company_id=cid(s))
        s.add(e)
        s.commit()
        return emp_dict(e)


@app.put("/api/employees/{id}")
def update_employee(id: int, body: EmployeePatch, s: Session = Depends(db)):
    updates = body.model_dump(exclude_unset=True)
    revision = updates.pop("revision", None)
    for key in ("name", "designation", "is_board_member", "board_order", "display_order", "is_active"):
        if key in updates and updates[key] is None:
            raise HTTPException(422, f"{key} cannot be empty")
    validate_image_reference(updates.get("photo_path"))
    with hierarchy_lock:
        e = get_emp(s, id)
        if revision is not None and revision != e.revision:
            raise HTTPException(409, "This person was changed by someone else. Reload and try again.")
        if "reports_to_id" in updates:
            validate_manager(s, id, updates["reports_to_id"])
        if "department_id" in updates:
            validate_department(s, updates["department_id"], e.department_id)
        for k, v in updates.items():
            setattr(e, k, v)
        e.revision += 1
        if not e.is_active:
            release_reports(s, e)
        s.commit()
        return emp_dict(e)


@app.delete("/api/employees/{id}")
def delete_employee(id: int, hard: bool = False, s: Session = Depends(db)):
    """Deactivates by default; ?hard=true (administrators only) removes the row."""
    if hard:
        require_admin(s)
    with hierarchy_lock:
        e = get_emp(s, id)
        release_reports(s, e)
        if hard:
            s.delete(e)
        else:
            e.is_active = False
            e.revision += 1
        s.commit()
    return {"ok": True}


@app.get("/api/employees/{id}/manager")
def manager(id: int, s: Session = Depends(db)):
    e = get_emp(s, id)
    return emp_dict(s.get(Employee, e.reports_to_id)) if e.reports_to_id else None


@app.get("/api/employees/{id}/direct-reports")
def reports(id: int, s: Session = Depends(db)):
    get_emp(s, id)
    return [emp_dict(e) for e in direct_reports(s, id)]


@app.get("/api/employees/{id}/reporting-chain")
def chain(id: int, s: Session = Depends(db)):
    """Manager, manager's manager, ... to the top (excludes the employee)."""
    out, seen, cur = [], {id}, get_emp(s, id)
    while cur.reports_to_id and cur.reports_to_id not in seen:
        cur = get_emp(s, cur.reports_to_id)
        seen.add(cur.id)
        out.append(emp_dict(cur))
    return out


PUBLIC_FIELDS = ("id", "name", "designation", "department_name", "photo_path", "reports_to_id", "is_board_member", "board_order", "display_order")


@app.get("/api/public/companies")
def public_companies():
    with SessionLocal() as s:
        return [{"id": c.id, "company_name": c.company_name, "logo_path": c.logo_path}
                for c in s.scalars(select(CompanySettings).order_by(CompanySettings.id)).all()]


@app.get("/api/public/chart")
def public_chart(company: int = 1):
    """Read-only data for the landing page: active people only, and no admin fields (revision, timestamps...)."""
    with SessionLocal() as s:
        if not s.get(CompanySettings, company):
            raise HTTPException(404, "Company not found")
        s.info["company_id"] = company
        data = org_chart(s)
        slim = lambda e: {k: e[k] for k in PUBLIC_FIELDS}
        return {"company": data["company"], "board": [slim(e) for e in data["board"]],
                "nodes": [slim(e) for e in data["nodes"]], "edges": data["edges"]}


@app.get("/api/org-chart")
def org_chart(s: Session = Depends(db)):
    es = s.scalars(select(Employee).where(Employee.is_active, Employee.company_id == cid(s)).order_by(Employee.display_order, Employee.name)).all()
    ids = {e.id for e in es}
    board = sorted((e for e in es if e.is_board_member), key=lambda e: (e.board_order, e.name))
    return {
        "company": settings_dict(s),
        "board": [emp_dict(e) for e in board],
        "nodes": [emp_dict(e) for e in es],
        "edges": [{"source": e.reports_to_id, "target": e.id} for e in es if e.reports_to_id in ids],
    }


@app.get("/api/companies")
def list_companies(request: Request):
    user = request.state.user
    with SessionLocal() as s:
        counts = dict(s.execute(select(Employee.company_id, func.count()).where(Employee.is_active).group_by(Employee.company_id)).all())
        return [{"id": c.id, "company_name": c.company_name, "logo_path": c.logo_path, "employee_count": counts.get(c.id, 0)}
                for c in s.scalars(select(CompanySettings).order_by(CompanySettings.id)).all()
                if user["is_admin"] or str(c.id) in user["memberships"]]


@app.post("/api/companies", status_code=201)
def create_company(body: CompanyIn, request: Request):
    security.require_admin(request)
    with SessionLocal() as s:
        name = " ".join(body.company_name.split())
        if any(c.company_name.casefold() == name.casefold() for c in s.scalars(select(CompanySettings)).all()):
            raise HTTPException(409, "A company with this name already exists")
        c = CompanySettings(company_name=name)
        s.add(c)
        s.commit()
        return {"id": c.id, "company_name": c.company_name, "logo_path": c.logo_path, "employee_count": 0}


@app.get("/api/settings")
def get_settings(s: Session = Depends(db)):
    return settings_dict(s)


@app.put("/api/settings")
def put_settings(body: SettingsIn, s: Session = Depends(db)):
    validate_image_reference(body.logo_path)
    c = s.get(CompanySettings, cid(s))
    c.company_name, c.logo_path = body.company_name, body.logo_path
    s.commit()
    return settings_dict(s)


async def save_image(file: UploadFile, prefix: str):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        raise HTTPException(400, "Image must be png, jpg, gif or webp")
    data = await file.read(5_000_001)
    if len(data) > 5_000_000:
        raise HTTPException(400, "Image too large (5 MB max)")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {"PNG", "JPEG", "GIF", "WEBP"} or image.width * image.height > 16_000_000:
                    raise ValueError("Unsupported image or dimensions")
                image.load()
                image.thumbnail((1600, 1600))
                cleaned = image.convert("RGBA")
                name = f"{prefix}-{uuid.uuid4().hex}.png"
                cleaned.save(UPLOADS / name, "PNG")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(400, "Upload a valid image (maximum 16 megapixels)")
    return {"path": name}  # relative to /uploads


@app.post("/api/upload/photo")
async def upload_photo(request: Request, file: UploadFile = File(...)):
    require_editor(request)
    return await save_image(file, "photo")


@app.post("/api/upload/logo")
async def upload_logo(request: Request, file: UploadFile = File(...)):
    require_editor(request)
    return await save_image(file, "logo")


class ChartPosition(BaseModel):
    id: str = Field(max_length=30)
    x: float = Field(ge=-1000000, le=1000000, allow_inf_nan=False)
    y: float = Field(ge=-1000000, le=1000000, allow_inf_nan=False)
    depth: int = Field(default=0, ge=0, le=10000)
    stacked: bool = False
    label: str = Field(default="", max_length=100)


class ExportIn(BaseModel):
    scope: str = Field(pattern="^(full|visible)$")
    ids: list[int] = Field(default_factory=list, max_length=10000)
    paper: str = Field(default="a4", pattern="^(chart|a4|letter)$")
    orientation: str = Field(default="portrait", pattern="^(portrait|landscape)$")
    layout: str | None = Field(default=None, pattern="^(radial|compact|tree)$")
    positions: list[ChartPosition] = Field(default_factory=list, max_length=10002)


@app.post("/api/export/pdf")
def export_pdf(body: ExportIn, s: Session = Depends(db)):
    from pdf_export import make_pdf, make_chart_pdf
    data = org_chart(s)
    # Board members with no manager appear only in the Board of Directors box (matches the chart);
    # their direct reports keep a reporting line from that box.
    mgr = {e["target"] for e in data["edges"]}
    top = {e["id"] for e in data["nodes"] if e["is_board_member"] and e["id"] not in mgr}
    board_kids = [e["target"] for e in data["edges"] if e["source"] in top]
    data["nodes"] = [e for e in data["nodes"] if e["id"] not in top]
    data["edges"] = [e for e in data["edges"] if e["source"] not in top]
    if body.scope == "visible":
        ids = set(body.ids)
        data["nodes"] = [e for e in data["nodes"] if e["id"] in ids]
        if body.layout is None:
            data["board"] = [e for e in data["board"] if e["id"] in ids]
        data["edges"] = [e for e in data["edges"] if e["source"] in ids and e["target"] in ids]
    shown = {e["id"] for e in data["nodes"]}
    data["board_kids"] = [k for k in board_kids if k in shown]
    if not data["nodes"]:
        raise HTTPException(400, "No employees to export")
    if body.layout:
        positions = {p.id: p.model_dump() for p in body.positions}
        required = {str(e["id"]) for e in data["nodes"]}
        if body.layout == "radial":
            required.add("company")
        if data["board"]:
            required.add("board")
        if not required.issubset(positions) or len(positions) != len(body.positions):
            raise HTTPException(400, "Chart positions are incomplete or duplicated. Refresh the chart and try again.")
        content = make_chart_pdf(data, UPLOADS, body.paper, body.orientation, body.scope, body.layout, positions)
    else:
        if body.paper == "chart":
            raise HTTPException(400, "Choose a chart layout for chart-sized export")
        content = make_pdf(data, UPLOADS, body.paper, body.orientation, body.scope)
    return Response(content, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="organization-chart-{body.layout or "hierarchy"}.pdf"'})


# Production: serve the built frontend from the same port (run `npm run build` first).
DIST = BASE.parent / "frontend" / "dist"
class Frontend(StaticFiles):
    """Built files under /assets are content-hashed (cache forever); pages must revalidate so a rebuild shows up."""
    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if "/assets/" in str(args[0]).replace("\\", "/") else "no-cache"
        return response


if DIST.exists():
    @app.get("/admin")
    @app.get("/admin/{path:path}")
    def admin_page(path: str = ""):
        # The admin screens are part of the same single-page app, so deep links load index.html.
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})

    app.mount("/", Frontend(directory=DIST, html=True), name="frontend")


if __name__ == "__main__" and sys.argv[1:2] in (["create-admin"], ["reset-password"]):
    import getpass
    password = getpass.getpass("Password (12+ characters): ")
    if sys.argv[1] == "create-admin":
        security.bootstrap_admin(engine, sys.argv[2], password)
        print("Administrator created.")
    else:
        security.reset_password(engine, sys.argv[2], password)
        print("Password reset; existing sessions were signed out.")
