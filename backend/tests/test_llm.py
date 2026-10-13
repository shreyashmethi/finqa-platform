"""LLM label-mapping guard rails (no live model needed)."""

import os

from app.agents import llm
from app.agents.llm import LabelResolver, worth_asking
from app.domain.vocabulary import normalise_label


def test_worth_asking_skips_dates_codes_and_prose():
    assert worth_asking(normalise_label("Turnover"))
    assert worth_asking(normalise_label("Profit attributable to owners of the parent"))
    assert not worth_asking(normalise_label("2024-04-01"))  # GL detail date column
    assert not worth_asking(normalise_label("12345"))
    assert not worth_asking(normalise_label("x"))
    prose = "further detail on supplier diversification is provided in the governance section of this report"
    assert not worth_asking(normalise_label(prose))


class _CountingLLM:
    def __init__(self):
        self.asked = []

    def map(self, label, context):
        self.asked.append(label)
        return "revenue" if label == "Gross receipts from customers" else None


def test_resolver_only_calls_llm_for_label_shaped_text(env):
    fake = _CountingLLM()
    resolver = LabelResolver(segments=[], llm=fake)
    assert resolver("Gross receipts from customers", False) == "revenue"
    assert resolver("2024-04-01", False) is None
    assert resolver("training on data privacy was completed by most eligible employees across all sites", False) is None
    assert fake.asked == ["Gross receipts from customers"]
    assert resolver.stats["llm"] == 1 and resolver.stats["unmapped"] == 2


def test_build_llm_mapper_exports_provider_key_from_dotenv(tmp_path, monkeypatch):
    """Provider keys in .env (not FINQA_*) must reach os.environ, where provider SDKs look."""
    (tmp_path / ".env").write_text("SOME_PROVIDER_API_KEY=from-dotenv\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("SOME_PROVIDER_API_KEY", raising=False)
    monkeypatch.setattr(llm, "get_settings", lambda: type("S", (), {"llm_model": "x:y", "llm_max_calls_per_run": 1})())
    monkeypatch.setattr(llm, "LLMLabelMapper", lambda model_id, max_calls: object())
    assert llm.build_llm_mapper() is not None
    assert os.environ["SOME_PROVIDER_API_KEY"] == "from-dotenv"
