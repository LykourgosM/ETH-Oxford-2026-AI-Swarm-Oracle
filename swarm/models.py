from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass

import openai
from dotenv import load_dotenv

from swarm.config import MODEL, TEMPERATURE

load_dotenv()


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


class OpenAIProvider(LLMProvider):
    def __init__(self, model: str | None = None):
        self._model = model or MODEL
        self._client = openai.AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

    @property
    def model_id(self) -> str:
        return self._model

    async def complete(self, system: str, user: str, temperature: float = TEMPERATURE) -> LLMResponse:
        resp = await self._client.chat.completions.create(
            model=self._model,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return LLMResponse(content=resp.choices[0].message.content, model=self._model)


# ── Model pool ──────────────────────────────────────────────────────

def get_available_providers() -> list[LLMProvider]:
    """Return providers for which API keys are configured."""
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY not set.")
    return [OpenAIProvider()]
