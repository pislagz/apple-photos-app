import os

# Must happen before any osxphotos import anywhere in the process: several
# of its CLI/utils helpers check this env var to skip a PyPI version check.
os.environ.setdefault("OSXPHOTOS_NO_VERSION_CHECK", "1")
