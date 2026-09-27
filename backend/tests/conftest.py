import sys
from pathlib import Path

# Make `app.*` importable when running `pytest` from the repo root or backend/.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
