#!/usr/bin/env python3
"""Parse Python ORM model files (Django models.py, SQLAlchemy declarative) into a normalized model.

Uses only the standard library (``ast``) — no third-party deps. Output is JSON on stdout:
    {"source": ..., "confidence": "directional", "tables": [{"name", "columns", ...}]}

Confidence is ``directional``: fields resolved by inheritance/metaclass/loops are not seen by a
static AST walk, so for an authoritative model prefer Django ``migrations/`` or ``inspectdb`` (Tier-1).

Usage: python3 parse-orm-python.py --file <path>
"""
import argparse
import ast
import json
import sys


def _kw(call, name):
    for kw in call.keywords:
        if kw.arg == name:
            try:
                return ast.literal_eval(kw.value)
            except Exception:
                return ast.dump(kw.value)
    return None


def _field_type(node):
    """Return the field constructor name, e.g. Django CharField or SQLAlchemy Column(Integer)."""
    if isinstance(node, ast.Call):
        f = node.func
        name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", None)
        return name
    return None


def parse(source):
    tree = ast.parse(source)
    tables = []
    for cls in [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]:
        bases = {b.attr if isinstance(b, ast.Attribute) else getattr(b, "id", "") for b in cls.bases}
        is_django = any("Model" in b for b in bases)
        is_sqla = any(b in ("Base", "DeclarativeBase") for b in bases) or any(
            _field_type(getattr(s, "value", None)) in ("Column", "mapped_column") for s in cls.body
        )
        if not (is_django or is_sqla):
            continue
        cols, pk, fks = [], [], []
        table_name = cls.name.lower()
        for stmt in cls.body:
            # Handle both `x = Column(...)` (Assign) and SQLAlchemy 2.0 `x: Mapped[int] = mapped_column(...)` (AnnAssign).
            target, value = None, None
            if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
                target, value = stmt.targets[0].id, stmt.value
            elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                target, value = stmt.target.id, stmt.value
            if target is None:
                continue
            if target == "__tablename__":
                try:
                    table_name = ast.literal_eval(value)
                except Exception:
                    pass
                continue
            ftype = _field_type(value)
            if not ftype:
                continue
            call = value
            col = {
                "name": target,
                "type": (ftype or "").lower(),
                "notNull": _kw(call, "null") is False or _kw(call, "nullable") is False,
                "pk": bool(_kw(call, "primary_key")),
                "unique": bool(_kw(call, "unique")),
            }
            if col["pk"]:
                pk.append(target)
            # Django ForeignKey/OneToOneField, OR a nested ForeignKey("table.col") inside Column/mapped_column args.
            ref = None
            if ftype in ("ForeignKey", "OneToOneField") and getattr(call, "args", None):
                a = call.args[0]
                ref = ast.literal_eval(a) if isinstance(a, ast.Constant) else (a.id if isinstance(a, ast.Name) else None)
            elif ftype in ("Column", "mapped_column"):
                for a in getattr(call, "args", []):
                    if isinstance(a, ast.Call) and _field_type(a) in ("ForeignKey", "ForeignKeyConstraint") and a.args and isinstance(a.args[0], ast.Constant):
                        ref = a.args[0].value  # "table.col"
                        break
            if ref is not None:
                rt = str(ref).split(".")[0].lower()
                fks.append({"columns": [target], "refTable": rt, "refColumns": ["id"]})
            cols.append(col)
        if cols:
            tables.append({"name": table_name, "columns": cols, "primaryKey": pk or ["id"], "indexes": [], "foreignKeys": fks})
    return {"confidence": "directional", "tables": tables,
            "note": "AST-parsed Python ORM source; prefer Django migrations/ or inspectdb (Tier-1) for an authoritative model."}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    args = ap.parse_args()
    try:
        with open(args.file, encoding="utf-8") as fh:
            source = fh.read()
    except OSError as e:
        print(json.dumps({"error": f"cannot read file: {e}"}))
        sys.exit(1)
    try:
        model = parse(source)
    except SyntaxError as e:
        print(json.dumps({"error": f"python syntax error: {e}"}))
        sys.exit(1)
    model["source"] = args.file
    model["table_count"] = len(model["tables"])
    print(json.dumps(model, indent=2))


if __name__ == "__main__":
    main()
