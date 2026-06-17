"""Reference-file integrity tests.

Every ``references/*.md`` must be ≤200 lines (project rule). If a reference
legitimately needs more, the right move is to split it into focused sub-files
and turn the original into an index, not to raise the budget.

We also sanity-check the JSON schemas under ``schema/`` parse as valid JSON,
since the whole finding contract depends on them.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests._helpers import REPO_ROOT

REFERENCES_DIR = REPO_ROOT / "references"
SCHEMA_DIR = REPO_ROOT / "schema"
MAX_LINES = 200

REFERENCE_FILES = sorted(REFERENCES_DIR.glob("*.md"))
_REF_PARAMS = REFERENCE_FILES or [
    pytest.param(None, marks=pytest.mark.skip(reason="no references/*.md present yet"))
]

SCHEMA_FILES = sorted(SCHEMA_DIR.glob("*.json"))
_SCHEMA_PARAMS = SCHEMA_FILES or [
    pytest.param(None, marks=pytest.mark.skip(reason="no schema/*.json present yet"))
]


@pytest.mark.parametrize("ref_path", _REF_PARAMS, ids=lambda p: p.name if p else "none")
def test_reference_under_line_budget(ref_path: Path) -> None:
    line_count = sum(1 for _ in ref_path.open("r", encoding="utf-8"))
    assert line_count <= MAX_LINES, (
        f"{ref_path.name}: {line_count} lines > {MAX_LINES} limit. "
        f"Split into focused sub-files and convert the original into an index."
    )


@pytest.mark.parametrize(
    "schema_path", _SCHEMA_PARAMS, ids=lambda p: p.name if p else "none"
)
def test_schema_is_valid_json(schema_path: Path) -> None:
    data = json.loads(schema_path.read_text(encoding="utf-8"))
    assert isinstance(data, dict), f"{schema_path.name}: top-level JSON must be an object"
