"""
Reconciliation rules that admins can change at runtime.

Defaults come from settings; overrides live in the ``app_settings`` table and are edited through
``PUT /api/settings``. Each run reads the rules once at start and records them in its stats, so a
run's result can always be explained by the rules that were in force.
"""

from dataclasses import asdict, dataclass

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import AppSetting


@dataclass
class Rules:
    anomaly_threshold: float
    baseline_metrics: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


EDITABLE_KEYS = {"anomaly_threshold", "baseline_metrics"}


def load_rules(db: Session) -> Rules:
    s = get_settings()
    rules = Rules(anomaly_threshold=s.anomaly_threshold, baseline_metrics=list(s.baseline_metrics))
    for row in db.query(AppSetting).filter(AppSetting.key.in_(EDITABLE_KEYS)):
        setattr(rules, row.key, row.value)
    return rules


def save_rules(db: Session, changes: dict, username: str) -> Rules:
    """Validate and persist rule overrides; unknown keys are rejected by the API schema."""
    for key, value in changes.items():
        if key not in EDITABLE_KEYS:
            raise ValueError(f"Unknown setting {key}")
        row = db.get(AppSetting, key)
        if row is None:
            db.add(AppSetting(key=key, value=value, updated_by=username))
        else:
            row.value, row.updated_by = value, username
    db.flush()
    return load_rules(db)
