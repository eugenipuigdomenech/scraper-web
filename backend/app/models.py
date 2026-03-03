from dataclasses import dataclass
from typing import Any


@dataclass
class FaqItem:
    id: str
    topic: str
    question: str
    answer: str
    source: str
    approved_var: Any
