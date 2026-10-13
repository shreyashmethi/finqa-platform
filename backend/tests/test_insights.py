"""Audit log, reports, users and system status endpoints, plus the company/run list filters."""

from tests.conftest import ADMIN, ANALYST, AUDITOR
from tests.test_api import _wait


def _reviewed(client):
    run = _wait(client, client.post("/api/sets/T001-FY2025/runs", headers=ANALYST).json()["id"])
    assert run["status"] == "succeeded"
    return run


def test_audit_log_lists_decisions_newest_first(client):
    _reviewed(client)
    items = client.get("/api/exceptions", headers=ANALYST, params={"set_id": "T001-FY2025"}).json()["items"]
    client.post(f"/api/exceptions/{items[0]['id']}/decisions", headers=ANALYST, json={"action": "accept"})
    client.post(
        f"/api/exceptions/{items[1]['id']}/decisions", headers=ADMIN, json={"action": "reject", "comment": "ok"}
    )

    log = client.get("/api/decisions", headers=AUDITOR).json()
    assert log["total"] == 2
    assert [e["action"] for e in log["items"]] == ["reject", "accept"]
    assert log["items"][0]["set_id"] == "T001-FY2025" and log["items"][0]["metric"]
    only_alice = client.get("/api/decisions", headers=AUDITOR, params={"username": "alice"}).json()
    assert [e["username"] for e in only_alice["items"]] == ["alice"]
    assert client.get("/api/decisions", headers=AUDITOR, params={"action": "override"}).json()["total"] == 0


def test_reports_aggregate_open_and_decided(client):
    _reviewed(client)
    items = client.get("/api/exceptions", headers=ANALYST, params={"set_id": "T001-FY2025"}).json()["items"]
    client.post(f"/api/exceptions/{items[0]['id']}/decisions", headers=ANALYST, json={"action": "accept"})

    r = client.get("/api/reports", headers=AUDITOR).json()
    t001 = next(c for c in r["by_company"] if c["company_id"] == "T001")
    assert (t001["sets"], t001["open"], t001["decided"]) == (1, 2, 1)
    assert sum(n for sev in r["type_by_severity"].values() for n in sev.values()) == 2
    assert sum(r["by_metric"].values()) == 2
    assert r["decisions_by_user"] == {"alice": 1} and r["decisions_by_action"] == {"accept": 1}


def test_users_and_system_are_admin_only_and_hide_secrets(client):
    assert client.get("/api/users", headers=ANALYST).status_code == 403
    assert client.get("/api/system", headers=AUDITOR).status_code == 403
    _reviewed(client)

    users = client.get("/api/users", headers=ADMIN).json()
    assert {u["username"]: u["role"] for u in users} == {
        "adam": "admin",
        "alice": "analyst",
        "arun": "auditor",
        "carol": "controller",
    }
    alice = next(u for u in users if u["username"] == "alice")
    assert alice["runs_started"] == 1 and alice["last_active"]
    assert "token" not in str(users)

    s = client.get("/api/system", headers=ADMIN).json()
    assert s["database"] == "sqlite" and s["counts"]["document_sets"] == 1
    assert s["runs_by_status"] == {"succeeded": 1}
    assert "sqlite://" not in str(s)  # the DB URL may hold credentials: never returned


def test_company_filter_and_run_filters(client):
    run = _reviewed(client)
    assert client.get("/api/exceptions", headers=ANALYST, params={"company_id": "T001"}).json()["total"] == 3
    assert client.get("/api/exceptions", headers=ANALYST, params={"company_id": "NOPE"}).json()["total"] == 0
    csv = client.get("/api/exceptions/export.csv", headers=ANALYST, params={"company_id": "T001"}).text
    assert len(csv.strip().splitlines()) == 4  # header + 3

    assert [r["id"] for r in client.get("/api/runs", headers=ANALYST, params={"status": "succeeded"}).json()] == [
        run["id"]
    ]
    assert client.get("/api/runs", headers=ANALYST, params={"status": "failed"}).json() == []
    assert client.get("/api/runs", headers=ANALYST, params={"created_by": "carol"}).json() == []
