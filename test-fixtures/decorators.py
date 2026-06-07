from dataclasses import dataclass


@dataclass
class Job:
    name: str

    @staticmethod
    def run(value: str) -> str:
        return value.upper()

