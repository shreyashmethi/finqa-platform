"""
Multi-agent reconciliation runtime built on LangGraph.

    state.py   typed graph state shared by all agents
    tools.py   function-calling tools with validated JSON schemas + an executor (retries, tracing)
    llm.py     optional LLM label mapper (rules first, cached, budgeted)
    nodes.py   the supervisor and the four specialist agents
    graph.py   wiring of nodes into a LangGraph StateGraph
    runner.py  custom run loop: background execution, checkpoint persistence, resume, cancel
"""
