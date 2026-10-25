# Sourced: $PYTHON, else backend/.venv, else python3.
if [ -z "${PYTHON:-}" ]; then
  if [ -x "$root/backend/.venv/bin/python" ]; then PYTHON="$root/backend/.venv/bin/python"; else PYTHON=python3; fi
fi
