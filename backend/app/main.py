"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db, async_session
from app.models.models import Entity, Relation, Project
from app.graph.engine import graph_engine
from app.routers import projects, entities, relations, transforms, simulations, world_entries
from sqlalchemy import select


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: init DB and load graph into memory
    await init_db()
    async with async_session() as session:
        # Load all entities
        result = await session.execute(select(Entity))
        entities_list = result.scalars().all()
        graph_engine.load_entities(entities_list)

        # Load all relations
        result = await session.execute(select(Relation))
        relations_list = result.scalars().all()
        graph_engine.load_relations(relations_list)

    print(f"Graph engine loaded: {len(graph_engine.entities)} entities, "
          f"{sum(len(r) for r in graph_engine.adjacency.values()) // 2} relations")

    yield

    # Shutdown
    print("Shutting down...")


app = FastAPI(
    title="WorldBuilder API",
    description="Knowledge graph worldbuilding platform with AI-assisted investigation",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for frontend dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(projects.router)
app.include_router(entities.router)
app.include_router(relations.router)
app.include_router(transforms.router)
app.include_router(simulations.router)
app.include_router(world_entries.router)


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "entities": len(graph_engine.entities),
        "relations": sum(len(r) for r in graph_engine.adjacency.values()) // 2,
    }
