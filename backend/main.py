import asyncio

from fastapi import FastAPI
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware

from config import Settings

@asynccontextmanager
async def lifespan(app: FastAPI) -> None:
    settings = Settings()

    
    app.state.settings      = settings
    
    print(f"[Backend] Started")




