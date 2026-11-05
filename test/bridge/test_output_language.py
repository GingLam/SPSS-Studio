import io
import tempfile
import unittest
from unittest.mock import patch

from test_spss_bridge import BRIDGE_MODULE, FakeSpss


class LanguageSpss(FakeSpss):
    def __init__(self) -> None:
        super().__init__()
        self.language = "English"
        self.language_calls = []
        self.language_error = None
        self.reported_language = None

    def SetOutputLanguage(self, language: str) -> None:
        self.language_calls.append(language)
        if self.language_error:
            raise RuntimeError(self.language_error)
        self.language = language

    def GetSetting(self, setting: str) -> str:
        if setting != "OLANG":
            raise ValueError(setting)
        return self.reported_language or self.language


class OutputLanguageTests(unittest.TestCase):
    def test_ping_initializes_native_language_without_using_submit(self) -> None:
        for language in ("Schinese", "English"):
            fake = LanguageSpss()
            bridge = BRIDGE_MODULE.SpssBridge(fake)
            response = bridge.handle({"id": "ping", "op": "ping", "outputLanguage": language})
            self.assertTrue(response["engineAlive"])
            self.assertEqual(fake.language_calls, [language])
            self.assertEqual(fake.submissions, [])

    def test_policy_is_reapplied_before_each_user_run_and_can_change(self) -> None:
        fake = LanguageSpss()
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        bridge.handle({"id": "ping", "op": "ping", "outputLanguage": "Schinese"})
        with tempfile.TemporaryDirectory() as directory:
            for language in ("Schinese", "English"):
                fake.language = "German"  # A previous user command changed OLANG.
                response = bridge.handle({"id": language, "op": "run", "syntax": "FREQUENCIES age.",
                                          "outputDirectory": directory, "runId": language,
                                          "outputLanguage": language})
                self.assertTrue(response["ok"])
                self.assertEqual(fake.language, language)
        self.assertEqual(fake.language_calls, ["Schinese", "Schinese", "English"])
        self.assertEqual(fake.start_count, 1)

    def test_documented_set_olang_fallback_when_python_setter_is_missing(self) -> None:
        fake = LanguageSpss()
        fake.SetOutputLanguage = None
        original_submit = fake.Submit

        def submit(syntax: str) -> None:
            if syntax.startswith("SET OLANG="):
                fake.language = syntax[len("SET OLANG="):-1]
            original_submit(syntax)

        fake.Submit = submit
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        bridge.start("Schinese")
        self.assertEqual(fake.submissions, ["SET OLANG=Schinese."])
        self.assertTrue(bridge.started)

    def test_failed_language_initialization_stops_started_processor(self) -> None:
        fake = LanguageSpss()
        fake.language_error = "missing language files"
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        with self.assertRaisesRegex(RuntimeError, "Could not set SPSS output language to Schinese.*missing language files"):
            bridge.start("Schinese")
        self.assertFalse(fake.started)
        self.assertFalse(bridge.started)
        self.assertEqual(fake.stop_count, 1)
        self.assertIn("Schinese", bridge.last_error)

    def test_readback_mismatch_fails_instead_of_silently_accepting_english(self) -> None:
        fake = LanguageSpss()
        fake.reported_language = "English"
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        with self.assertRaisesRegex(RuntimeError, "reported OLANG='English'"):
            bridge.start("Schinese")
        self.assertFalse(bridge.started)
        self.assertEqual(fake.stop_count, 1)

    def test_missing_readback_api_is_an_explicit_policy_error(self) -> None:
        fake = LanguageSpss()
        fake.GetSetting = None
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        with self.assertRaisesRegex(RuntimeError, "Could not set SPSS output language to Schinese"):
            bridge.start("Schinese")
        self.assertFalse(bridge.started)

    def test_language_failure_before_run_never_submits_user_syntax(self) -> None:
        fake = LanguageSpss()
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        bridge.start("Schinese")
        fake.language_error = "language no longer available"
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "language no longer available"):
                bridge.run("COMPUTE age=1.", directory, "run", "Schinese")
        self.assertEqual(fake.submissions, [])
        self.assertTrue(bridge.started)

    def test_cleanup_failure_keeps_state_for_an_explicit_shutdown_retry(self) -> None:
        fake = LanguageSpss()
        fake.language_error = "language unavailable"
        stop = fake.StopSPSS

        def stop_failure() -> None:
            raise RuntimeError("processor stop failed")

        fake.StopSPSS = stop_failure
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        with self.assertRaisesRegex(RuntimeError, "startup cleanup failed: processor stop failed"):
            bridge.start("Schinese")
        self.assertTrue(bridge.started)
        fake.StopSPSS = stop
        self.assertTrue(bridge.shutdown()["ok"])
        self.assertFalse(bridge.started)

    def test_language_api_noise_stays_out_of_jsonl_stdout(self) -> None:
        fake = LanguageSpss()
        setter = fake.SetOutputLanguage

        def noisy_setter(language: str) -> None:
            print("设置输出语言")
            setter(language)

        fake.SetOutputLanguage = noisy_setter
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        stdout = io.StringIO()
        stderr = io.StringIO()
        with patch.multiple(BRIDGE_MODULE.sys, stdout=stdout, stderr=stderr):
            bridge.start("Schinese")
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn("设置输出语言", stderr.getvalue())

    def test_invalid_language_fails_before_starting_processor(self) -> None:
        fake = LanguageSpss()
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        with self.assertRaisesRegex(ValueError, "Unsupported SPSS output language"):
            bridge.start("Schinese. NEW FILE.")
        self.assertEqual(fake.start_count, 0)

    def test_legacy_requests_keep_the_original_optional_protocol(self) -> None:
        fake = FakeSpss()
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        self.assertTrue(bridge.handle({"id": "ping", "op": "ping"})["engineAlive"])
        self.assertEqual(fake.submissions, [])


if __name__ == "__main__":
    unittest.main()
