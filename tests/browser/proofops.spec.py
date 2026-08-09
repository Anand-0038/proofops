#!/usr/bin/env python3
"""Real-browser acceptance journey for the ProofOps operator console."""

from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from urllib.request import urlopen

from playwright.sync_api import ConsoleMessage, Page, sync_playwright


ROOT = Path(__file__).resolve().parents[2]
SCREENSHOTS = ROOT / "docs" / "assets" / "screenshots"
TOKEN = "proofops-browser-operator-token"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_server(base_url: str, process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("fixture server exited before becoming ready")
        try:
            with urlopen(f"{base_url}/api/health", timeout=0.5) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.15)
    raise TimeoutError("fixture server did not become ready in 30 seconds")


def capture_browser_problem(problems: list[str], message: ConsoleMessage) -> None:
    if message.type == "error":
        problems.append(f"console: {message.text}")


def assert_no_fixture_links(page: Page) -> None:
    external = page.locator('a[target="_blank"]')
    assert external.count() == 0, "fixture evidence exposed an external live link"


def run_journey(base_url: str) -> None:
    SCREENSHOTS.mkdir(parents=True, exist_ok=True)
    problems: list[str] = []

    with sync_playwright() as playwright:
        chrome = Path("/usr/bin/google-chrome")
        launch = {
            "headless": True,
            "args": ["--no-sandbox", "--disable-dev-shm-usage"],
        }
        if chrome.exists():
            launch["executable_path"] = str(chrome)
        browser = playwright.chromium.launch(**launch)

        desktop = browser.new_context(
            viewport={"width": 1440, "height": 1000},
            accept_downloads=True,
            reduced_motion="reduce",
        )
        page = desktop.new_page()
        page.on("console", lambda message: capture_browser_problem(problems, message))
        page.on("pageerror", lambda error: problems.append(f"page: {error}"))
        page.goto(base_url, wait_until="networkidle")

        assert page.get_by_role(
            "heading", name="Every mitigation should survive an investigation."
        ).is_visible()
        assert page.get_by_text("LOCAL READY", exact=True).is_visible()
        assert page.locator("#submission-ready-label").count() == 0
        assert page.locator(".rail-stage").count() == 8
        assert page.locator("#evidence-rows tr").count() >= 4
        assert page.locator("#evidence-rows tr").count() <= 12
        assert_no_fixture_links(page)

        page.locator("#evidence-search").fill("browser-simulation-blocked")
        assert page.locator("#evidence-rows tr").count() == 1
        assert page.get_by_text("1 of 1 matched records", exact=False).is_visible()
        page.get_by_role("button", name="Reset filters").click()
        assert page.locator("#evidence-rows tr").count() >= 4

        page.locator("#inspect-safety-proof").click()
        assert page.locator("#selected-run-id").text_content() == "browser-simulation-blocked"
        assert page.locator('.rail-stage[data-stage="simulate"]').get_attribute(
            "aria-expanded"
        ) == "true"

        animation_iterations = page.locator(".signal-pulse").evaluate(
            "(node) => getComputedStyle(node).animationIterationCount"
        )
        assert animation_iterations == "1", "reduced motion was not respected"

        first_stage = page.locator('.rail-stage[data-stage="observe"]')
        first_stage.focus()
        page.keyboard.press("Tab")
        focused_stage = page.evaluate(
            "() => document.activeElement && document.activeElement.dataset.stage"
        )
        assert focused_stage == "policy", "flight-recorder stages are not tab ordered"

        unauthorized = desktop.request.post(
            f"{base_url}/api/cycle",
            data={},
            headers={"Content-Type": "application/json"},
        )
        assert unauthorized.status == 401

        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(100)
        page.screenshot(
            path=str(SCREENSHOTS / "proofops-incident-console.png"),
            full_page=False,
        )
        page.locator(".workspace").screenshot(
            path=str(SCREENSHOTS / "proofops-incident-context.png")
        )

        simulation_row = page.locator(
            'button[title="Inspect evidence browser-simulation-blocked"]'
        )
        simulation_row.click()
        page.locator('.rail-stage[data-stage="simulate"]').click()
        assert page.locator("#stage-facts").get_by_text(
            "would_revert", exact=True
        ).is_visible()
        page.locator(".rail-shell").screenshot(
            path=str(SCREENSHOTS / "proofops-simulation-block.png")
        )

        recovery_row = page.locator(
            'button[title="Inspect evidence browser-retry-recovery"]'
        )
        recovery_row.click()
        page.locator('.rail-stage[data-stage="reconcile"]').click()
        assert page.get_by_text("2 submissions", exact=True).is_visible()
        page.locator(".rail-shell").screenshot(
            path=str(SCREENSHOTS / "proofops-retry-recovery.png")
        )

        token = page.locator("#operator-token")
        token.fill(TOKEN)
        page.get_by_role("button", name="Build mitigation proof").click()
        page.get_by_text(
            "Policy proof built. Exact action now awaits human approval.",
            exact=True,
        ).wait_for()
        assert int(page.locator("#approval-count").text_content() or "0") >= 1

        approval_button = page.get_by_role("button", name="Approve exact action").first
        approval_button.click()
        page.get_by_text(
            "No live transaction claimed.", exact=False
        ).wait_for()
        assert page.get_by_text("fixture_recovered", exact=True).count() >= 1
        assert_no_fixture_links(page)

        with page.expect_download() as download_info:
            page.get_by_role("link", name="JSON", exact=True).click()
        download = download_info.value
        assert download.suggested_filename == "proof-bundle.json"

        page.locator(".proof-receipt").screenshot(
            path=str(SCREENSHOTS / "proofops-proof-receipt.png")
        )

        mobile = browser.new_context(
            viewport={"width": 390, "height": 844},
            reduced_motion="reduce",
        )
        mobile_page = mobile.new_page()
        mobile_page.on(
            "console", lambda message: capture_browser_problem(problems, message)
        )
        mobile_page.on("pageerror", lambda error: problems.append(f"page: {error}"))
        mobile_page.goto(base_url, wait_until="networkidle")
        assert mobile_page.get_by_role(
            "heading", name="Every mitigation should survive an investigation."
        ).is_visible()
        mobile_page.screenshot(
            path=str(SCREENSHOTS / "proofops-mobile-console.png"),
            full_page=False,
        )
        overflow = mobile_page.evaluate(
            """() => ({
              body: document.body.scrollWidth,
              viewport: window.innerWidth,
              offenders: [...document.querySelectorAll('*')]
                .filter((node) => {
                  const box = node.getBoundingClientRect();
                  return box.right > window.innerWidth + 1 || box.left < -1;
                })
                .slice(0, 12)
                .map((node) => `${node.tagName}.${node.className}`)
            })"""
        )
        assert overflow["body"] <= overflow["viewport"], (
            f"mobile page has horizontal body overflow: {overflow}"
        )

        compact = browser.new_context(
            viewport={"width": 320, "height": 800},
            reduced_motion="reduce",
        )
        compact_page = compact.new_page()
        compact_page.goto(base_url, wait_until="networkidle")
        assert compact_page.locator("#refresh-console").is_visible()
        compact_overflow = compact_page.evaluate(
            "() => ({ body: document.body.scrollWidth, viewport: window.innerWidth })"
        )
        assert compact_overflow["body"] <= compact_overflow["viewport"], (
            f"compact page has horizontal body overflow: {compact_overflow}"
        )

        compact.close()
        mobile.close()
        desktop.close()
        browser.close()

    assert not problems, "\n".join(problems)


def main() -> None:
    port = free_port()
    base_url = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="proofops-browser-") as temp:
        log_path = Path(temp) / "server.log"
        env = os.environ.copy()
        env.update(
            {
                "PORT": str(port),
                "BROWSER_TEST_DIR": temp,
                "PROOFOPS_ALLOWED_ORIGIN": base_url,
                "PROOFOPS_OPERATOR_TOKEN": TOKEN,
            }
        )
        with log_path.open("wb") as log:
            process = subprocess.Popen(
                ["npx", "tsx", "tests/browser/fixture-server.ts"],
                cwd=ROOT,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            try:
                wait_for_server(base_url, process)
                run_journey(base_url)
            except Exception:
                log.flush()
                if log_path.exists():
                    print(log_path.read_text(encoding="utf-8", errors="replace"))
                raise
            finally:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
    print(
        json.dumps(
            {
                "ok": True,
                "browser": "chromium",
                "viewports": ["1440x1000", "390x844", "320x800"],
                "screenshots": len(list(SCREENSHOTS.glob("proofops-*.png"))),
            }
        )
    )


if __name__ == "__main__":
    main()
