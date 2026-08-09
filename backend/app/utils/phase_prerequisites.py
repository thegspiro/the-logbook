"""Phase prerequisite graph helpers.

A program phase may declare ``prerequisite_phase_ids`` — other phases in the
same program that must be finished before it opens. That turns the phase list
into a directed graph, and a graph admits a failure mode a flat list does not:
a cycle ("Phase 2 needs Phase 3, Phase 3 needs Phase 2") that would leave every
enrolled member permanently stuck with no error anyone could act on.

The graph logic lives here rather than in the service so it can be exercised
without a database.
"""

from typing import Dict, List, Optional, Sequence


def find_cycle(graph: Dict[str, Sequence[str]], start: str) -> Optional[List[str]]:
    """The prerequisite chain that leads from ``start`` back to itself, or None.

    ``graph`` maps a phase id to the ids it depends on. Returns the cycle in
    dependency order so the caller can name the phases involved.
    """
    path: List[str] = []
    on_path: set = set()

    def walk(node: str) -> Optional[List[str]]:
        if node in on_path:
            return path[path.index(node) :] + [node]
        if node not in graph:
            return None
        path.append(node)
        on_path.add(node)
        for dependency in graph[node]:
            cycle = walk(dependency)
            if cycle is not None:
                return cycle
        path.pop()
        on_path.discard(node)
        return None

    return walk(start)
