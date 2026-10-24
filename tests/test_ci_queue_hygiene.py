"""CI must not pile up runs: superseded PR runs cancel, and bots never take a runner.

A contributor force-pushed ~65 PR branches at once (04:20 UTC) and 362 runs queued:
one CI run per push, plus a scam-guard run per review-bot comment.
"""
from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def _load(name: str) -> dict:
    return yaml.safe_load((ROOT / ".github/workflows" / name).read_text(encoding="utf-8"))


def test_ci_cancels_superseded_pr_runs_but_never_main_commits():
    concurrency = _load("ci.yml")["concurrency"]
    assert "pull_request.number" in concurrency["group"]
    assert concurrency["group"].endswith("github.sha }}"), "main pushes are keyed by commit"
    assert concurrency["cancel-in-progress"] == "${{ github.event_name == 'pull_request' }}"


def test_docker_cancels_only_older_main_pushes_never_releases_or_backfills():
    concurrency = _load("docker.yml")["concurrency"]
    assert "run_id" in concurrency["group"], "release/dispatch runs must get their own group"
    assert "event_name == 'push'" in concurrency["cancel-in-progress"]


def test_scam_guard_skips_bots_but_still_checks_every_human():
    job = _load("scam-guard.yml")["jobs"]["guard"]
    condition = job["if"]
    assert "sender.type != 'Bot'" in condition
    for human_roles in ("OWNER", "MEMBER", "COLLABORATOR", "author_association"):
        assert human_roles not in condition, "members and collaborators stay checked"
    assert set(_load("scam-guard.yml")[True]) == {"issues", "issue_comment"}


def test_other_pr_workflows_already_cancel_superseded_runs():
    for name in ("security.yml", "commit-identity.yml", "mobile.yml"):
        assert _load(name)["concurrency"]["cancel-in-progress"], name
