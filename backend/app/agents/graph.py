"""
LangGraph wiring (supervisor pattern).

            +-------------+
     START->| supervisor  |<-----------------------------+
            +------+------+                              |
                   | route(next_agent)                   |
   +-------------+-+-----------+-----------+-------+     |
   v             v             v           v       v     |
extraction  reconciliation  baseline  exceptions  finish |
   |             |             |           |       |     |
   +-------------+-------------+-----------+       v     |
                 (back to supervisor) ----------->END    |
                                                         |
Every agent returns to the supervisor, which re-plans from the checkpointed state. Each node has
a retry policy for transient failures on top of the tool-level retries.
"""

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import RetryPolicy
from sqlalchemy.exc import OperationalError

from app.agents import nodes
from app.agents.state import ReviewState
from app.agents.tools import TransientToolError

AGENTS = {
    nodes.EXTRACTION: nodes.extraction,
    nodes.RECONCILIATION: nodes.reconciliation,
    nodes.BASELINE: nodes.baseline,
    nodes.EXCEPTIONS: nodes.exceptions,
}


def build_graph(checkpointer: BaseCheckpointSaver | None = None):
    """Compile the review graph. Pass a checkpointer to make runs resumable."""
    g = StateGraph(ReviewState)
    # Retry a node only for transient infrastructure errors; logic errors fail the run so it can be
    # inspected and resumed from its last checkpoint.
    retry = RetryPolicy(
        max_attempts=2,
        initial_interval=1.0,
        retry_on=(OperationalError, TransientToolError, ConnectionError, TimeoutError),
    )
    g.add_node("supervisor", nodes.supervisor, retry_policy=retry)
    for name, fn in AGENTS.items():
        g.add_node(name, fn, retry_policy=retry)
    g.add_node(nodes.FINISH, nodes.finish)

    g.add_edge(START, "supervisor")
    g.add_conditional_edges("supervisor", nodes.route, {**{n: n for n in AGENTS}, nodes.FINISH: nodes.FINISH})
    for name in AGENTS:
        g.add_edge(name, "supervisor")
    g.add_edge(nodes.FINISH, END)
    return g.compile(checkpointer=checkpointer)
