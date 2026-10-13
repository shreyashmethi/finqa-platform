"""
Label mapping with an optional LLM fallback.

Numbers are never produced by the LLM: values, units and locations always come from deterministic
parsers so every figure stays traceable. The LLM is only asked one narrow question - "which
canonical metric does this row label mean, if any?" - for labels the synonym table does not know.

Resolution order for a label:
    1. rule-based vocabulary (app.domain.vocabulary.map_label)
    2. cache table ``label_mappings`` (answers from earlier LLM calls, also editable by admins)
    3. LLM call with structured output (only if FINQA_LLM_MODEL is set and the run budget allows)
"""

import logging
import re
import threading

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.db.models import LabelMapping
from app.db.session import session_scope
from app.domain.vocabulary import METRICS, SEGMENT_PREFIX, map_label, normalise_label

log = logging.getLogger(__name__)


class LabelAnswer(BaseModel):
    """Structured output schema the LLM must return."""

    metric: str | None = Field(
        description="One of the canonical metric names, or null if the label is not one of them."
    )


_PROMPT = (
    "You map row labels from financial statements to canonical metrics.\n"
    "Canonical metrics: {metrics}.\n"
    "Return the single best metric name, or null if the label is a different line item, a subtotal, "
    "a ratio, a region or anything else not in the list.\n"
    "Label: {label!r}\nTable context: {context!r}"
)


# Row labels are short phrases. Dates and codes in ledger rows ("2024 04 01") and sentences of prose
# that a PDF line happens to end with a number are never metrics, so they are not worth a call.
_MAX_LABEL_WORDS = 10
_HAS_WORD = re.compile(r"[a-z]{2,}")


def worth_asking(norm_label: str) -> bool:
    """True if a normalised label looks like a line-item name the LLM could map."""
    return len(norm_label) >= 3 and len(norm_label.split()) <= _MAX_LABEL_WORDS and bool(_HAS_WORD.search(norm_label))


class LLMLabelMapper:
    """Wraps a LangChain chat model; counts calls and tokens against a per-run budget."""

    def __init__(self, model_id: str, max_calls: int):
        # Imported lazily: langchain is an optional dependency (pip install .[llm]).
        from langchain.chat_models import init_chat_model

        self._model = init_chat_model(model_id).with_structured_output(LabelAnswer, include_raw=True)
        self.max_calls = max_calls
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0

    def map(self, label: str, context: str) -> str | None:
        if self.calls >= self.max_calls:
            return None
        self.calls += 1
        result = self._model.invoke(_PROMPT.format(metrics=", ".join(METRICS), label=label, context=context))
        usage = getattr(result.get("raw"), "usage_metadata", None) or {}
        self.input_tokens += usage.get("input_tokens", 0)
        self.output_tokens += usage.get("output_tokens", 0)
        answer: LabelAnswer | None = result.get("parsed")
        metric = answer.metric if answer else None
        return metric if metric in METRICS else None


class LabelResolver:
    """
    Callable passed to the parsers: ``resolver(label, segment_context) -> metric | None``.
    One resolver per run; it is thread-safe and keeps statistics for the run trace.
    """

    def __init__(self, segments: list[str], llm: LLMLabelMapper | None = None):
        self.segments = segments
        self.llm = llm
        self._lock = threading.Lock()
        self._seen: dict[tuple[str, bool], str | None] = {}
        self.stats = {"rules": 0, "cache": 0, "llm": 0, "unmapped": 0}

    def __call__(self, label: str, segment_context: bool) -> str | None:
        key = (label, segment_context)
        with self._lock:
            if key in self._seen:
                return self._seen[key]
        metric = self._resolve(label, segment_context)
        with self._lock:
            self._seen[key] = metric
        return metric

    def _resolve(self, label: str, segment_context: bool) -> str | None:
        metric = map_label(label, self.segments, segment_context)
        if metric:
            self.stats["rules"] += 1
            return metric
        norm = normalise_label(label)
        with session_scope() as db:
            cached = db.get(LabelMapping, norm)
            if cached is not None:
                self.stats["cache"] += 1
                return cached.metric
        if self.llm is None or not worth_asking(norm):
            self.stats["unmapped"] += 1
            return None
        try:
            metric = self.llm.map(label, "segment table" if segment_context else "financial table")
        except Exception:  # an LLM outage must never fail extraction; rules still work
            log.exception("LLM label mapping failed for %r", label)
            return None
        self.stats["llm"] += 1
        with session_scope() as db:
            db.merge(LabelMapping(label=norm, metric=metric, source="llm"))
        return metric


def build_llm_mapper() -> LLMLabelMapper | None:
    """Create the LLM mapper if a model is configured, else None (rules-only mode)."""
    settings = get_settings()
    if not settings.llm_model:
        return None
    # pydantic-settings reads only FINQA_* keys from .env; provider SDKs look for their own key
    # (e.g. ANTHROPIC_API_KEY) in os.environ, so export the rest of .env without overriding it.
    load_dotenv(".env", override=False)
    try:
        return LLMLabelMapper(settings.llm_model, settings.llm_max_calls_per_run)
    except Exception:
        log.exception("Could not initialise LLM %s; continuing rules-only", settings.llm_model)
        return None


__all__ = ["LabelResolver", "LLMLabelMapper", "build_llm_mapper", "SEGMENT_PREFIX"]
