"""Pytest configuration — make the repo root importable for ``tests._helpers``.

The pytest suite lives alongside the zero-dependency Node harness
(``tests/run.mjs``). It validates the plugin's authored surface — skills,
references, scripts — not the scoring logic (that is the Node harness's job).
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
