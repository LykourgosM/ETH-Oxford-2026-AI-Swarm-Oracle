from __future__ import annotations

import asyncio
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass

import google.genai as genai

from swarm.config import MODEL, TEMPERATURE


@dataclass
class LLMResponse:
    content: str
    model: str


class LLMProvider(ABC):
    @abstractmethod
    async def complete(self, system: str, user: str, temperature: float = TEMPERATURE) -> LLMResponse:
        ...

    @property
    @abstractmethod
    def model_id(self) -> str:
        ...


class GeminiProvider(LLMProvider):
    def __init__(self, model: str | None = None):
        self._model = model or MODEL
        self._client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    @property
    def model_id(self) -> str:
        return self._model

    async def complete(self, system: str, user: str, temperature: float = TEMPERATURE) -> LLMResponse:
        resp = await asyncio.to_thread(
            self._client.models.generate_content,
            model=self._model,
            contents=user,
            config=genai.types.GenerateContentConfig(
                system_instruction=system,
                temperature=temperature,
                max_output_tokens=1024,
            ),
        )
        return LLMResponse(content=resp.text, model=self._model)


# ── Model pool ──────────────────────────────────────────────────────

def get_available_providers() -> list[LLMProvider]:
    """Return providers for which API keys are configured."""
    if not os.environ.get("GEMINI_API_KEY"):
        raise RuntimeError("GEMINI_API_KEY not set. Get one free at https://aistudio.google.com/apikey")
    return [GeminiProvider()]
