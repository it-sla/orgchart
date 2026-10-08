import os, tempfile
os.environ["ORG_DB"] = os.path.join(tempfile.mkdtemp(), "t.db")

from fastapi.testclient import TestClient

import main
import io
from pathlib import Path
import pytest
from PIL import Image
from pypdf import PdfReader

c = TestClient(main.app)


def mk(name, to=None, **kw):
    r = c.post("/api/employees", json={"name": name, "reports_to_id": to, **kw})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_hierarchy_and_cycles():
    md = mk("MD", is_board_member=True)
    cfo = mk("CFO", md)
    fm = mk("FM", cfo)
    acc = mk("Acc", fm)
    assert [e["name"] for e in c.get(f"/api/employees/{acc}/reporting-chain").json()] == ["FM", "CFO", "MD"]
    assert [e["name"] for e in c.get(f"/api/employees/{md}/direct-reports").json()] == ["CFO"]
    assert c.get(f"/api/employees/{cfo}/manager").json()["name"] == "MD"
    # self-report, and a cycle (MD under Acc, who is below MD)
    body = {"name": "MD", "reports_to_id": md}
    assert c.put(f"/api/employees/{md}", json=body).status_code == 400
    body["reports_to_id"] = acc
    assert c.put(f"/api/employees/{md}", json=body).status_code == 400
    assert any(e["name"] == "MD" for e in c.get("/api/org-chart").json()["board"])
    # deactivating CFO moves FM up to MD; inactive managers are rejected
    assert c.delete(f"/api/employees/{cfo}").status_code == 200
    assert c.get(f"/api/employees/{fm}").json()["reports_to_id"] == md
    assert c.post("/api/employees", json={"name": "x", "reports_to_id": cfo}).status_code == 400


@pytest.mark.parametrize("name", ["", "   ", "x" * 201])
def test_invalid_names(name):
    assert c.post("/api/employees", json={"name": name}).status_code == 422
    assert c.put("/api/settings", json={"company_name": name}).status_code == 422


def test_trim_names_and_validate_references():
    id = mk("  Trimmed employee  ", designation="  Manager  ")
    employee = c.get(f"/api/employees/{id}").json()
    assert employee["name"] == "Trimmed employee"
    assert employee["designation"] == "Manager"
    for reference in ["missing.png", "../requirements.txt"]:
        assert c.put("/api/settings", json={"company_name": "Test", "logo_path": reference}).status_code == 400
        assert c.post("/api/employees", json={"name": "Bad reference", "photo_path": reference}).status_code == 400


def test_image_validation_and_normalization(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "UPLOADS", tmp_path)
    for payload in [b"not an image", b""]:
        assert c.post("/api/upload/photo", files={"file": ("fake.png", payload, "image/png")}).status_code == 400
    assert not list(tmp_path.iterdir())
    assert c.post("/api/upload/photo", files={"file": ("large.png", b"x" * 5_000_001, "image/png")}).status_code == 400
    image = io.BytesIO()
    Image.new("RGB", (2000, 50), "blue").save(image, "JPEG")
    response = c.post("/api/upload/photo", files={"file": ("portrait.jpg", image.getvalue(), "image/jpeg")})
    assert response.status_code == 200
    name = response.json()["path"]
    with Image.open(tmp_path / name) as saved:
        assert saved.format == "PNG"
        assert saved.width <= 1600
    assert c.post("/api/employees", json={"name": "With photo", "photo_path": name}).status_code == 201


def test_pdf_scope_pagination_and_paper():
    manager = mk("PDF manager")
    child = mk("PDF visible child", manager)
    hidden = mk("PDF hidden grandchild", child)
    for i in range(20):
        mk(f"PDF report {i:02}", hidden)
    for paper, orientation in [("a4", "portrait"), ("letter", "landscape")]:
        response = c.post("/api/export/pdf", json={"scope": "full", "ids": [manager], "paper": paper, "orientation": orientation})
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        reader = PdfReader(io.BytesIO(response.content))
        assert len(reader.pages) > 1
        text = "\n".join(page.extract_text() for page in reader.pages)
        for label in ["PDF manager", "PDF visible child", "PDF hidden grandchild", "PDF report 19"]:
            assert label in text
        box = reader.pages[0].mediabox
        assert (float(box.width) > float(box.height)) == (orientation == "landscape")
    response = c.post("/api/export/pdf", json={"scope": "visible", "ids": [manager, child]})
    reader = PdfReader(io.BytesIO(response.content))
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert "PDF manager" in text and "PDF visible child" in text
    assert "PDF hidden grandchild" not in text
    assert "2 people" in text
    assert c.post("/api/export/pdf", json={"scope": "visible", "ids": []}).status_code == 400
    assert c.post("/api/export/pdf", json={"scope": "full", "paper": "huge"}).status_code == 422


def test_pdf_long_labels_are_not_truncated():
    name, role = "W" * 200, "M" * 200
    id = mk(name, designation=role)
    response = c.post("/api/export/pdf", json={"scope": "visible", "ids": [id]})
    reader = PdfReader(io.BytesIO(response.content))
    text = "".join(page.extract_text() for page in reader.pages).replace("\n", "")
    assert name in text
    assert role in text


@pytest.mark.parametrize("layout", ["radial", "compact", "tree"])
def test_chart_pdf_preserves_layout_and_scope(layout):
    manager = mk(f"{layout} export manager")
    child = mk(f"{layout} export child", manager)
    hidden = mk(f"{layout} hidden report", child)
    positions = [{"id": str(manager), "x": 0, "y": 0}, {"id": str(child), "x": 300, "y": 300}]
    positions.append({"id": "company" if layout == "radial" else "board", "x": -200, "y": -200})
    body = {"scope": "visible", "ids": [manager, child], "layout": layout, "positions": positions, "paper": "chart"}
    for paper in ["chart", "a4", "letter"]:
        body["paper"] = paper
        response = c.post("/api/export/pdf", json=body)
        assert response.status_code == 200
        assert layout in response.headers["content-disposition"]
        reader = PdfReader(io.BytesIO(response.content))
        assert len(reader.pages) == 1
        text = " ".join(reader.pages[0].extract_text().split())
        assert f"{layout.title()} layout" in text
        assert f"{layout} export manager" in text
        assert f"{layout} export child" in text
        assert f"{layout} hidden report" not in text
        if paper == "a4":
            assert float(reader.pages[0].mediabox.width) == pytest.approx(595.276, abs=.01)
    body["positions"] = positions[:1]
    assert c.post("/api/export/pdf", json=body).status_code == 400
    body["positions"] = positions + [positions[0]]
    assert c.post("/api/export/pdf", json=body).status_code == 400
    body["positions"] = [{"id": str(manager), "x": 1000001, "y": 0}]
    assert c.post("/api/export/pdf", json=body).status_code == 422


def test_department_lifecycle_and_employee_assignments():
    response = c.post("/api/departments", json={"name": "  Sales   and Marketing  ", "description": "  Customer growth  "})
    assert response.status_code == 201
    department = response.json()
    department_id = department["id"]
    assert department["name"] == "Sales and Marketing"
    assert department["description"] == "Customer growth"
    assert c.post("/api/departments", json={"name": "sales AND marketing"}).status_code == 409
    for invalid in ["", "   ", "x" * 101]:
        assert c.post("/api/departments", json={"name": invalid}).status_code == 422
    assert c.post("/api/employees", json={"name": "Bad department", "department_id": 999999}).status_code == 400
    assert c.post("/api/employees", json={"name": "Bad department", "department_id": -1}).status_code == 422
    active = mk("Department active employee", designation="Sales Manager", department_id=department_id)
    inactive = mk("Department inactive employee", is_active=False, department_id=department_id)
    item = next(d for d in c.get("/api/departments").json() if d["id"] == department_id)
    assert item["employee_count"] == 2 and item["active_employee_count"] == 1
    department["name"] = "Commercial"
    assert c.put(f"/api/departments/{department_id}", json=department).status_code == 200
    employee = c.get(f"/api/employees/{active}").json()
    assert employee["department_name"] == "Commercial" and employee["designation"] == "Sales Manager"
    chart_employee = next(e for e in c.get("/api/org-chart").json()["nodes"] if e["id"] == active)
    assert chart_employee["department_name"] == "Commercial"
    department["is_active"] = False
    assert c.put(f"/api/departments/{department_id}", json=department).status_code == 200
    assert c.post("/api/employees", json={"name": "New assignment", "department_id": department_id}).status_code == 400
    # Existing membership survives unrelated edits and requests from older clients.
    assert c.put(f"/api/employees/{active}", json={"name": employee["name"], "designation": "Senior Sales Manager"}).status_code == 200
    assert c.get(f"/api/employees/{active}").json()["department_id"] == department_id
    assert c.put(f"/api/employees/{active}", json={"name": employee["name"], "department_id": department_id}).status_code == 200
    assert c.post("/api/departments", json={"name": "COMMERCIAL"}).status_code == 409
    assert c.put(f"/api/employees/{active}", json={"name": employee["name"], "department_id": None}).status_code == 200
    assert c.get(f"/api/employees/{active}").json()["department_name"] is None
    department["is_active"] = True
    assert c.put(f"/api/departments/{department_id}", json=department).status_code == 200
    assert c.put(f"/api/employees/{active}", json={"name": employee["name"], "department_id": department_id}).status_code == 200
    assert c.put("/api/departments/999999", json={"name": "Unknown"}).status_code == 404


def test_existing_database_department_migration_is_additive_and_idempotent(tmp_path):
    from sqlalchemy import create_engine, text, inspect
    database = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with database.begin() as connection:
        connection.execute(text("CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, designation TEXT, reports_to_id INTEGER)"))
        connection.execute(text("INSERT INTO employees VALUES (1, 'Existing manager', 'Director', NULL), (2, 'Existing employee', 'Executive', 1)"))
    main.migrate_employee_fields(database)
    main.migrate_employee_fields(database)
    with database.connect() as connection:
        assert "department_id" in {column["name"] for column in inspect(connection).get_columns("employees")}
        rows = connection.execute(text("SELECT * FROM employees ORDER BY id")).all()
        assert rows == [(1, "Existing manager", "Director", None, None, 1), (2, "Existing employee", "Executive", 1, None, 1)]
    database.dispose()


def test_department_crud_delete_protects_all_employee_memberships():
    department = c.post("/api/departments", json={"name": "CRUD department"}).json()
    id = department["id"]
    assert c.get(f"/api/departments/{id}").json()["name"] == "CRUD department"
    assert c.delete(f"/api/departments/{id}?hard=true").status_code == 409
    active = mk("CRUD active member", department_id=id)
    inactive = mk("CRUD inactive member", department_id=id, is_active=False)
    assert c.delete(f"/api/departments/{id}").status_code == 200
    assert c.get(f"/api/departments/{id}").json()["is_active"] is False
    assert c.get(f"/api/employees/{active}").json()["department_id"] == id
    assert c.delete(f"/api/departments/{id}?hard=true").status_code == 409
    assert c.put(f"/api/employees/{active}", json={"name": "CRUD active member", "department_id": None}).status_code == 200
    # Inactive employees also prevent deletion, preserving their historical membership.
    assert c.delete(f"/api/departments/{id}?hard=true").status_code == 409
    assert c.put(f"/api/employees/{inactive}", json={"name": "CRUD inactive member", "is_active": False, "department_id": None}).status_code == 200
    assert c.delete(f"/api/departments/{id}?hard=true").status_code == 200
    assert c.get(f"/api/departments/{id}").status_code == 404
    assert c.delete(f"/api/departments/{id}").status_code == 404
    assert c.get(f"/api/employees/{active}").status_code == 200
    assert c.get(f"/api/employees/{inactive}").status_code == 200
    assert c.post("/api/departments", json={"name": "CRUD department"}).status_code == 201


def test_tree_pdf_with_stacked_team_and_group():
    boss = mk("stack boss")
    kids = [mk(f"stack kid {i}", boss) for i in range(3)]
    loose = mk("loose person")
    positions = [{"id": str(boss), "x": 0, "y": 0}, {"id": "group", "x": 0, "y": 400, "label": "Not yet placed (1)"},
                 {"id": str(loose), "x": 0, "y": 456}, {"id": "board", "x": 0, "y": -200}]
    positions += [{"id": str(k), "x": 24, "y": 96 + i * 86, "stacked": True} for i, k in enumerate(kids)]
    body = {"scope": "visible", "ids": [boss, loose, *kids], "layout": "tree", "positions": positions, "paper": "chart"}
    response = c.post("/api/export/pdf", json=body)
    assert response.status_code == 200, response.text
    text = " ".join(PdfReader(io.BytesIO(response.content)).pages[0].extract_text().split())
    assert "Not yet placed (1)" in text and "stack kid 2" in text and "loose person" in text


def test_companies_are_isolated():
    other = c.post("/api/companies", json={"company_name": "Second Co"})
    assert other.status_code == 201
    h = {"X-Company-Id": str(other.json()["id"])}
    assert c.post("/api/companies", json={"company_name": "second co"}).status_code == 409
    mine = mk("Company one boss")
    dep1 = c.post("/api/departments", json={"name": "Shared name"}).json()["id"]
    r = c.post("/api/employees", json={"name": "Second Co boss"}, headers=h)
    assert r.status_code == 201
    theirs = r.json()["id"]
    assert c.post("/api/departments", json={"name": "Shared name"}, headers=h).status_code == 201
    assert [e["name"] for e in c.get("/api/employees", headers=h).json()] == ["Second Co boss"]
    assert "Second Co boss" not in [e["name"] for e in c.get("/api/employees").json()]
    assert [d["name"] for d in c.get("/api/departments", headers=h).json()] == ["Shared name"]
    assert c.get(f"/api/employees/{theirs}").status_code == 404
    assert c.post("/api/employees", json={"name": "x", "reports_to_id": mine}, headers=h).status_code == 400
    assert c.post("/api/employees", json={"name": "x", "department_id": dep1}, headers=h).status_code == 400
    assert [n["name"] for n in c.get("/api/org-chart", headers=h).json()["nodes"]] == ["Second Co boss"]
    assert c.get("/api/org-chart", headers=h).json()["company"]["company_name"] == "Second Co"
    assert c.get("/api/employees", headers={"X-Company-Id": "999"}).status_code == 404
    assert {x["company_name"] for x in c.get("/api/companies").json()} >= {"Second Co"}
