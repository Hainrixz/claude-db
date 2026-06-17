"""Script smoke tests.

Every ``scripts/*.mjs`` and ``scripts/*.py`` must EITHER respond to ``--help``
(or ``-h``) with exit code 0, OR carry a module docstring — for ``.py`` that is
a real module docstring, for ``.mjs`` it is the leading ``//`` comment block
that the foundation scripts use to document usage.

This guards against scripts that crash at import/parse time and against
undocumented entry points, without forcing every pure-logic script (e.g.
``score.mjs``, which reads findings from stdin) to grow a ``--help`` handler.

Library modules under ``scripts/lib/`` are skipped: they are imported, not run.
"""
from __future__ import annotations

import ast
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from tests._helpers import REPO_ROOT

SCRIPTS_DIR = REPO_ROOT / "scripts"

MJS_SCRIPTS = sorted(
    p for p in SCRIPTS_DIR.glob("*.mjs") if p.parent.name != "lib"
)
PY_SCRIPTS = sorted(
    p for p in SCRIPTS_DIR.glob("*.py") if p.name != "__init__.py"
)

_MJS_PARAMS = MJS_SCRIPTS or [
    pytest.param(None, marks=pytest.mark.skip(reason="no scripts/*.mjs present"))
]
_PY_PARAMS = PY_SCRIPTS or [
    pytest.param(None, marks=pytest.mark.skip(reason="no scripts/*.py present"))
]

_NODE_AVAILABLE = shutil.which("node") is not None


def _help_exits_zero(cmd: list[str]) -> bool:
    """True if either ``--help`` or ``-h`` exits 0 within a short timeout."""
    for flag in ("--help", "-h"):
        try:
            proc = subprocess.run(
                cmd + [flag], capture_output=True, text=True, timeout=30
            )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return False
        if proc.returncode == 0:
            return True
    return False


def _mjs_has_doc_comment(path: Path) -> bool:
    """True if the .mjs file opens with a ``//`` comment block (its docstring).

    A leading shebang line is allowed before the comment block.
    """
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#!"):
            continue
        return line.startswith("//") or line.startswith("/*")
    return False


@pytest.mark.parametrize("script_path", _MJS_PARAMS, ids=lambda p: p.name if p else "none")
def test_mjs_help_or_docstring(script_path: Path) -> None:
    has_doc = _mjs_has_doc_comment(script_path)
    if has_doc:
        # Documented entry point — that satisfies the contract on its own.
        return
    if not _NODE_AVAILABLE:
        pytest.skip("node not available to test --help and no doc comment present")
    assert _help_exits_zero(["node", str(script_path)]), (
        f"{script_path.name}: no leading // doc comment AND --help/-h did not exit 0"
    )


@pytest.mark.parametrize("script_path", _PY_PARAMS, ids=lambda p: p.name if p else "none")
def test_py_help_or_docstring(script_path: Path) -> None:
    tree = ast.parse(script_path.read_text(encoding="utf-8"))
    has_doc = bool(ast.get_docstring(tree))
    if has_doc:
        return
    assert _help_exits_zero([sys.executable, str(script_path)]), (
        f"{script_path.name}: no module docstring AND --help/-h did not exit 0"
    )
