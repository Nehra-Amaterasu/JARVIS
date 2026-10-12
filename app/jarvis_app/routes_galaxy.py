"""The memory galaxy: Yaadash as a 3D map that grows (ROADMAP Y1, Y2).

    GET /api/galaxy?max_nodes=8000&refresh=0   nodes, edges and the growth ledger
    GET /api/galaxy/node?id=<node id>          one node opened: source, date, excerpt
    GET /api/galaxy/growth                     the growth ledger alone (cheap after the first)

The layout lives in yaadash/yaadash_galaxy.py and is cached in the yaadash data folder,
recomputed only when the store changes. Laying it out reads LanceDB directly and never
loads the embedding model: the first open costs a PCA and an exact kNN (5.6 s for 8,000
memories on a synthetic store), not the 16 s model load, and every later open is a cache
read (~0.1 s) or a stale layout served while the new one builds in the background. All
of it runs off the event loop so the event stream and the twin never stall.
"""
from __future__ import annotations

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from .paths import LANCEDB, YAADASH_DATA, ensure_jarvis_importable

ensure_jarvis_importable()
import yaadash_galaxy as yg  # noqa: E402  (yaadash/ is on the path now)

# Read at request time, so a test can point them at a scratch store.
LANCEDB_DIR = LANCEDB
DATA_DIR = YAADASH_DATA


def register(app, svc, bus) -> None:
    def announce(res: dict) -> None:
        if bus is None:
            return
        c = res["counts"]
        bus.publish("memory", "galaxy",
                    f"Memory galaxy laid out: {c['memories_shown']:,} of {c['memories']:,} memories, "
                    f"{c['people']} people, {c['beliefs']} beliefs in {res['build_ms']} ms",
                    counts=c)

    @app.get("/api/galaxy")
    async def galaxy(max_nodes: int = yg.DEFAULT_MAX_MEMORIES, refresh: bool = False):
        # The store grows every voice turn; the layout of the last state is shown at
        # once ("stale": true) while the new one is built in the background, and the
        # UI asks again until it lands (yaadash_galaxy.galaxy explains the timings).
        try:
            res = await run_in_threadpool(yg.galaxy, LANCEDB_DIR, DATA_DIR, max_nodes, refresh,
                                          True, announce)
        except Exception as e:                       # a damaged store must not 500 the tab blank
            raise HTTPException(503, f"Could not lay out the memory galaxy: {e}")
        if not res["cached"]:
            announce(res)
        return res

    @app.get("/api/galaxy/node")
    async def galaxy_node(id: str):
        if not id or len(id) > 64:
            raise HTTPException(400, "bad node id")
        res = await run_in_threadpool(yg.node_detail, LANCEDB_DIR, DATA_DIR, id)
        if res is None:
            raise HTTPException(404, "No such node in the current layout — reload the galaxy.")
        return res

    @app.get("/api/galaxy/growth")
    async def galaxy_growth(max_nodes: int = yg.DEFAULT_MAX_MEMORIES):
        res = await run_in_threadpool(yg.galaxy, LANCEDB_DIR, DATA_DIR, max_nodes, False)
        return {"growth": res["growth"], "counts": res["counts"], "cached": res["cached"]}
