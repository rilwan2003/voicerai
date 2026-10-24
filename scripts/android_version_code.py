"""Shared version codes for serialized signed Android builds, independent of workflow counters."""

from __future__ import annotations

import time


EPOCH = 1_577_836_800  # 2020-01-01 UTC; keeps current codes within Google Play's range.
MAX_VERSION_CODE = 2_100_000_000


def version_code(timestamp: int | None = None) -> int:
    code = int(time.time() if timestamp is None else timestamp) - EPOCH
    if not 1 <= code <= MAX_VERSION_CODE:
        raise ValueError("Build timestamp is outside the Android version-code range")
    return code


if __name__ == "__main__":
    print(version_code())
