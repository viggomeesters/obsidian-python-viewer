import os
from pathlib import Path

DEFAULT_LIMIT = 25


def load_items(root: Path) -> list[str]:
    values = []
    for item in os.listdir(root):
        values.append(item)
    return values[:DEFAULT_LIMIT]

