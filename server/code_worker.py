#!/usr/bin/env python3
"""
Restricted Python worker for a single Code Block.
Communicates with the Node game server via JSON lines on stdin/stdout.

API injected for user scripts:
  activate(face) / deactivate(face) / set_face(face, on)
  get_face(face)           — this block's face on/off
  read_neighbor(face)      — activation of the Code Block face touching us on that side
  time.sleep(seconds)
  print(...)               — shows in game chat (system)
"""
from __future__ import annotations

import json
import sys
import threading
import time as _time
import traceback

FACES = frozenset({"+x", "-x", "+y", "-y", "+z", "-z"})
ALIASES = {
    "east": "+x",
    "west": "-x",
    "up": "+y",
    "down": "-y",
    "south": "+z",
    "north": "-z",
    "px": "+x",
    "nx": "-x",
    "py": "+y",
    "ny": "-y",
    "pz": "+z",
    "nz": "-z",
    "x+": "+x",
    "x-": "-x",
    "y+": "+y",
    "y-": "-y",
    "z+": "+z",
    "z-": "-z",
}

_out_lock = threading.Lock()
_req_id = 0
_pending: dict[int, list] = {}
_pending_lock = threading.Lock()
_stop = threading.Event()


def _emit(obj: dict) -> None:
    with _out_lock:
        sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def _normalize_face(face) -> str:
    s = str(face).strip().lower()
    if s in FACES:
        return s
    if s in ALIASES:
        return ALIASES[s]
    raise ValueError(f"Unknown face {face!r}. Use +x -x +y -y +z -z (or east/west/up/down/south/north)")


def _request(cmd: str, **kwargs):
    global _req_id
    if _stop.is_set():
        return None
    with _pending_lock:
        _req_id += 1
        rid = _req_id
        evt = threading.Event()
        _pending[rid] = [evt, None]
    _emit({"id": rid, "cmd": cmd, **kwargs})
    # Wait for reply (sleeps are in user code; get_face must not hang forever)
    ok = evt.wait(timeout=30.0)
    with _pending_lock:
        entry = _pending.pop(rid, None)
    if not ok or entry is None:
        return None
    return entry[1]


def _reader() -> None:
    for line in sys.stdin:
        if _stop.is_set():
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("type") == "stop":
            _stop.set()
            break
        if msg.get("type") == "reply" and "id" in msg:
            rid = int(msg["id"])
            with _pending_lock:
                entry = _pending.get(rid)
                if entry:
                    entry[1] = msg.get("value")
                    entry[0].set()


def activate(face) -> None:
    set_face(face, True)


def deactivate(face) -> None:
    set_face(face, False)


def set_face(face, on=True) -> None:
    f = _normalize_face(face)
    _request("set_face", face=f, value=bool(on))


def get_face(face) -> bool:
    f = _normalize_face(face)
    v = _request("get_face", face=f)
    return bool(v)


def read_neighbor(face) -> bool:
    """Read whether the neighboring Code Block face touching us on `face` is active."""
    f = _normalize_face(face)
    v = _request("read_neighbor", face=f)
    return bool(v)


def _safe_print(*args, **kwargs):
    text = " ".join(str(a) for a in args)
    if len(text) > 200:
        text = text[:200] + "…"
    _emit({"cmd": "print", "text": text})


class _TimeModule:
    def sleep(self, seconds):
        try:
            s = float(seconds)
        except (TypeError, ValueError):
            s = 0
        s = max(0.0, min(s, 60.0))  # cap single sleep at 60s
        # Interruptible sleep
        end = _time.monotonic() + s
        while not _stop.is_set():
            left = end - _time.monotonic()
            if left <= 0:
                break
            _time.sleep(min(0.05, left))
        if _stop.is_set():
            raise SystemExit(0)


_time_mod = _TimeModule()

SAFE_BUILTINS = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "float": float,
    "int": int,
    "len": len,
    "list": list,
    "max": max,
    "min": min,
    "pow": pow,
    "print": _safe_print,
    "range": range,
    "round": round,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
    "True": True,
    "False": False,
    "None": None,
    "Exception": Exception,
    "ValueError": ValueError,
    "TypeError": TypeError,
    "RuntimeError": RuntimeError,
}


def run_user_code(source: str) -> None:
    env = {
        "__builtins__": SAFE_BUILTINS,
        "activate": activate,
        "deactivate": deactivate,
        "set_face": set_face,
        "get_face": get_face,
        "read_neighbor": read_neighbor,
        "time": _time_mod,
    }
    try:
        compiled = compile(source, "<code_block>", "exec")
        exec(compiled, env, env)
    except SystemExit:
        pass
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        _emit({"cmd": "error", "text": msg[:300]})
        tb = traceback.format_exc()
        _emit({"cmd": "error", "text": tb[-400:]})


def main() -> None:
    # First line from server: {"type":"start","code":"..."}
    first = sys.stdin.readline()
    if not first:
        return
    try:
        start = json.loads(first)
    except json.JSONDecodeError:
        return
    if start.get("type") != "start":
        return
    code = start.get("code") or ""
    if not isinstance(code, str):
        code = str(code)

    t = threading.Thread(target=_reader, daemon=True)
    t.start()

    # Run once; long-running scripts use while True themselves.
    # If the script exits quickly, restart after a short pause so simple
    # one-shot scripts still work when re-saved, and crash-loops recover.
    while not _stop.is_set():
        run_user_code(code)
        if _stop.is_set():
            break
        for _ in range(20):
            if _stop.is_set():
                break
            _time.sleep(0.05)

    _emit({"cmd": "exited"})


if __name__ == "__main__":
    main()
