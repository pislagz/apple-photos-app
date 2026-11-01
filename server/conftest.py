import os
import pathlib
import sys

# server/ is not installed (Phase 1 adds the root pyproject.toml and
# `pip install -e`). Put it on sys.path so `import photos_viewer` resolves
# under pytest without an install step.
sys.path.insert(0, str(pathlib.Path(__file__).parent))

# Must be set before anything imports osxphotos: several of its CLI/utils
# helpers check this at import or call time to skip a PyPI version check.
os.environ.setdefault("OSXPHOTOS_NO_VERSION_CHECK", "1")
