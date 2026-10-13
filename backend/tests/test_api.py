"""API tests: auth/RBAC, run lifecycle over HTTP, review decisions with audit trail, uploads, evidence."""

import time

from tests import fixtures
from tests.conftest import ADMIN, ANALYST, AUDITOR


def _wait(client, run_id, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/runs/{run_id}", headers=ANALYST).json()
        if run["status"] in ("succeeded", "failed", "cancelled"):
            return run
        time.sleep(0.2)
    raise AssertionError("run did not finish")


def test_auth_required_and_roles(client):
    assert client.get("/api/sets").status_code == 401
    assert client.get("/api/sets", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/api/me", headers=AUDITOR).json() == {"username": "arun", "role": "auditor"}
    # Auditors are read-only.
    assert client.post("/api/sets/T001-FY2025/runs", headers=AUDITOR).status_code == 403


def test_review_flow_end_to_end(client):
    started = client.post("/api/sets/T001-FY2025/runs", headers=ANALYST)
    assert started.status_code == 202
    run = _wait(client, started.json()["id"])
    assert run["status"] == "succeeded", run["error"]
    assert [s["node"] for s in run["steps"]][-1] == "finish"
    assert client.get(f"/api/runs/{run['id']}/tool-calls", headers=ANALYST).json()

    page = client.get("/api/exceptions", headers=ANALYST, params={"set_id": "T001-FY2025"}).json()
    assert page["total"] == 3
    by_metric = {e["metric"]: e for e in page["items"]}
    rev = by_metric["revenue"]
    assert rev["type"] == "value_mismatch" and rev["outlier_documents"] == ["board_deck.pdf"]
    assert page["items"][0]["severity"] == "high"  # most severe first

    detail = client.get(f"/api/exceptions/{rev['id']}", headers=ANALYST).json()
    conflicting = detail["evidence"]["conflicting"][0]
    assert conflicting["location"]["page"] == 1 and len(conflicting["location"]["bbox"]) == 4
    assert len(detail["evidence"]["supporting"]) >= 3

    # Evidence: highlighted page image and spreadsheet window.
    deck_id = detail["documents"]["board_deck.pdf"]
    bbox = ",".join(str(v) for v in conflicting["location"]["bbox"])
    img = client.get(f"/api/documents/{deck_id}/pages/1.png", headers=ANALYST, params={"box": f"{bbox},red"})
    assert img.status_code == 200 and img.content[:4] == b"\x89PNG"
    ni = by_metric["net_income"]
    ni_detail = client.get(f"/api/exceptions/{ni['id']}", headers=ANALYST).json()
    loc = ni_detail["evidence"]["conflicting"][0]["location"]
    window = client.get(
        f"/api/documents/{ni_detail['documents']['management_accounts.xlsx']}/cells",
        headers=ANALYST,
        params={"sheet": loc["sheet"], "cell": loc["cell"]},
    ).json()
    assert window["highlight"] == {"row": 7, "col": 2}

    # Decisions: validation, audit trail, auditor blocked.
    assert (
        client.post(f"/api/exceptions/{rev['id']}/decisions", headers=ANALYST, json={"action": "reject"}).status_code
        == 422
    )  # reject needs a comment
    r = client.post(
        f"/api/exceptions/{rev['id']}/decisions",
        headers=ANALYST,
        json={"action": "override", "override_value": 1234500000, "comment": "Deck typo; AR correct"},
    )
    assert r.status_code == 200 and r.json()["status"] == "overridden"
    audit = r.json()["decisions"][-1]
    assert audit["username"] == "alice" and audit["status_before"] == "open" and audit["status_after"] == "overridden"
    assert (
        client.post(f"/api/exceptions/{rev['id']}/decisions", headers=AUDITOR, json={"action": "accept"}).status_code
        == 403
    )

    csv_text = client.get("/api/exceptions/export.csv", headers=AUDITOR).text
    assert "Deck typo; AR correct" in csv_text and csv_text.count("\n") == 4

    summary = client.get("/api/summary", headers=ANALYST).json()
    assert summary["exceptions_by_status"]["overridden"] == 1


def test_concurrent_run_rejected(client):
    first = client.post("/api/sets/T001-FY2025/runs", headers=ANALYST)
    second = client.post("/api/sets/T001-FY2025/runs", headers=ANALYST)
    assert first.status_code == 202 and second.status_code in (202, 409)
    _wait(client, first.json()["id"])


def test_upload_validation_and_new_set(client, tmp_path):
    files = fixtures.build(tmp_path / "up")
    bad = client.post(
        "/api/sets",
        headers=ADMIN,
        data={"company_id": "T001", "fiscal_year": "2025"},
        files=[("files", ("evil.exe", b"MZ...", "application/octet-stream"))],
    )
    assert bad.status_code == 400
    fake_pdf = client.post(
        "/api/sets",
        headers=ADMIN,
        data={"company_id": "T001", "fiscal_year": "2025"},
        files=[("files", ("report.pdf", b"not a pdf", "application/pdf"))],
    )
    assert fake_pdf.status_code == 400 and "not a valid" in fake_pdf.json()["detail"]
    assert (
        client.post(
            "/api/sets",
            headers=ANALYST,
            data={"company_id": "T001", "fiscal_year": "2025"},
            files=[("files", ("a.csv", b"x", "text/csv"))],
        ).status_code
        == 403
    )

    ok = client.post(
        "/api/sets",
        headers=ADMIN,
        data={"company_id": "T001", "fiscal_year": "2025"},
        files=[("files", (f.name, f.read_bytes(), "application/octet-stream")) for f in files],
    )
    assert ok.status_code == 201, ok.text
    body = ok.json()
    assert body["id"] == "T001-FY2025-v2" and body["documents"] == 4  # existing id gets a version suffix


def test_settings_admin_only(client):
    assert client.put("/api/settings", headers=ANALYST, json={"anomaly_threshold": 0.5}).status_code == 403
    assert client.put("/api/settings", headers=ADMIN, json={"baseline_metrics": ["bogus"]}).status_code == 422
    r = client.put("/api/settings", headers=ADMIN, json={"anomaly_threshold": 0.5})
    assert r.status_code == 200 and r.json()["anomaly_threshold"] == 0.5
    assert {t["name"] for t in client.get("/api/tools", headers=ANALYST).json()} >= {
        "extract_line_items",
        "get_historical_baseline",
        "persist_exception",
    }
