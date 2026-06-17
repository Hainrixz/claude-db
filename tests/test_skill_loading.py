"""Skill-loading tests.

Every ``skills/*/SKILL.md`` must:

* Have parseable YAML frontmatter declaring ``name`` and ``description``.
* Have ``name`` exactly equal to its parent directory (the ``/claude-db:<name>``
  contract).
* NEVER use the misspelled ``user-invokable`` key (the correct key is
  ``disable-model-invocation``, and only ``skills/fix`` may set it).
* Only reference repo files (references/, schema/, scripts/, agents/, docs/)
  that actually exist.

These are the safety net for adding modules without silently breaking the
orchestrator. The suite is robust to an in-progress file set: if no SKILL.md
files exist yet, the parametrized tests are simply skipped rather than failing.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from tests._helpers import REPO_ROOT, find_path_links, read_frontmatter

SKILL_FILES = sorted((REPO_ROOT / "skills").glob("*/SKILL.md"))

# Guard so an empty skills/ dir yields a clean skip, not a collection error.
_SKILL_PARAMS = SKILL_FILES or [
    pytest.param(None, marks=pytest.mark.skip(reason="no skills/*/SKILL.md present yet"))
]


@pytest.mark.parametrize(
    "skill_path", _SKILL_PARAMS, ids=lambda p: p.parent.name if p else "none"
)
def test_frontmatter_parses(skill_path: Path) -> None:
    fm, _ = read_frontmatter(skill_path)
    assert fm, f"{skill_path}: frontmatter missing or unparseable"
    assert "name" in fm, f"{skill_path}: frontmatter missing `name`"
    assert "description" in fm, f"{skill_path}: frontmatter missing `description`"


@pytest.mark.parametrize(
    "skill_path", _SKILL_PARAMS, ids=lambda p: p.parent.name if p else "none"
)
def test_name_matches_directory(skill_path: Path) -> None:
    fm, _ = read_frontmatter(skill_path)
    parent_name = skill_path.parent.name
    assert fm.get("name") == parent_name, (
        f"{skill_path}: name={fm.get('name')!r} does not match directory {parent_name!r}"
    )


@pytest.mark.parametrize(
    "skill_path", _SKILL_PARAMS, ids=lambda p: p.parent.name if p else "none"
)
def test_no_misspelled_invocability_key(skill_path: Path) -> None:
    """The misspelled ``user-invokable`` key must never appear in frontmatter."""
    text = skill_path.read_text(encoding="utf-8")
    end = text.find("\n---", 4) if text.startswith("---\n") else -1
    fm_block = text[:end] if end != -1 else text
    assert "user-invokable" not in fm_block, (
        f"{skill_path}: forbidden misspelled key `user-invokable` in frontmatter "
        f"(use `disable-model-invocation`, and only on skills/fix)"
    )


@pytest.mark.parametrize(
    "skill_path", _SKILL_PARAMS, ids=lambda p: p.parent.name if p else "none"
)
def test_only_fix_disables_model_invocation(skill_path: Path) -> None:
    """Only ``skills/fix`` may set ``disable-model-invocation: true``."""
    fm, _ = read_frontmatter(skill_path)
    val = str(fm.get("disable-model-invocation", "")).lower()
    if skill_path.parent.name != "fix":
        assert val != "true", (
            f"{skill_path}: only skills/fix may set disable-model-invocation: true"
        )


@pytest.mark.parametrize(
    "skill_path", _SKILL_PARAMS, ids=lambda p: p.parent.name if p else "none"
)
def test_referenced_files_exist(skill_path: Path) -> None:
    _, body = read_frontmatter(skill_path)
    missing = [ref for ref in find_path_links(body) if not (REPO_ROOT / ref).exists()]
    assert not missing, f"{skill_path}: broken references → {missing}"
