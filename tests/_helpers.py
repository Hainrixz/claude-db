"""Shared test helpers — no external dependencies.

The frontmatter used across this repo is simple (flat ``key: value`` pairs,
occasional folded ``>`` scalars), so we parse it with a small hand-rolled
function rather than pulling PyYAML into the project. claude-db ships zero
runtime dependencies and the test suite keeps that promise.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def find_repo_root() -> Path:
    """Return the repo root regardless of cwd."""
    return REPO_ROOT


def read_frontmatter(md_path: Path) -> tuple[dict[str, str], str]:
    """Parse YAML-ish frontmatter from a Markdown file.

    Returns ``(frontmatter_dict, body)``. If no frontmatter is present returns
    ``({}, full_text)``. Handles flat scalars, single/double quotes, and folded
    ``>`` multi-line scalars (used by long ``description`` fields).
    """
    text = md_path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}, text

    # Locate the closing '---' line after the opening one.
    end_match = re.search(r"^---\s*$", text[4:], re.MULTILINE)
    if not end_match:
        return {}, text

    fm_block = text[4 : 4 + end_match.start()]
    body = text[4 + end_match.end() :].lstrip("\n")

    fm: dict[str, str] = {}
    current_key: str | None = None
    folded_lines: list[str] = []
    folded_active = False

    for raw_line in fm_block.splitlines():
        line = raw_line.rstrip()

        # Continuation of a folded scalar (>) — indented or blank line.
        if folded_active and (line.startswith("  ") or line == ""):
            folded_lines.append(line.strip())
            continue
        if folded_active:
            fm[current_key] = " ".join(s for s in folded_lines if s)  # type: ignore[index]
            folded_active = False
            folded_lines = []

        m = re.match(r"^([A-Za-z][A-Za-z0-9_\-]*):\s*(.*)$", line)
        if not m:
            continue
        key, value = m.group(1), m.group(2).strip()
        current_key = key
        if value == ">":
            folded_active = True
            folded_lines = []
            continue
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        fm[key] = value

    if folded_active and current_key is not None:
        fm[current_key] = " ".join(s for s in folded_lines if s)

    return fm, body


# Paths inside the repo that a SKILL.md body may reference. Returns repo-relative
# strings so callers can existence-check them. Kept deliberately broad so it
# stays useful as modules, references, and schema files are added.
_REF_PATTERN = re.compile(
    r"(?:references|schema|scripts|agents|docs)/[A-Za-z0-9_\-./]+\.(?:md|json|mjs|py|sql)"
)


def find_path_links(body: str) -> set[str]:
    """Return the set of repo-relative file paths referenced in body text."""
    return {p for p in _REF_PATTERN.findall(body) if not p.endswith("/")}
