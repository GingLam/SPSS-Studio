"""Regression coverage for the in-memory SPSS submission boundary."""

import tempfile
import unittest

from test_spss_bridge import BRIDGE_MODULE, FakeSpss


class SyntaxNormalizationTests(unittest.TestCase):
    def test_reported_recode_crlf_becomes_lf_without_rewriting_recode(self):
        source = (
            "RECODE cti ccw cgf cpg cps\r\n"
            "    (1=0)\r\n"
            "    (2=1) (3=1)\r\n"
            "    (4=1) (5=1)\r\n"
            "    INTO ncti nccw ncgf ncpg ncps.\r\n"
        )
        normalized, tab_count, tab_lines = BRIDGE_MODULE._normalize_syntax_for_submit(source)
        self.assertEqual(normalized, source.replace("\r\n", "\n"))
        self.assertEqual((tab_count, tab_lines), (0, []))

    def test_crlf_physical_endings_are_normalized_in_protected_regions(self):
        source = (
            "TITLE 'line one\r\nline two'.\r\n"
            "/* comment\tkeep indentation */\r\n"
            "BEGIN DATA\r\n\t1\t2\r\nEND DATA.\r\n"
            "BEGIN PROGRAM PYTHON3.\r\n\tprint('keep\\t')\r\nEND PROGRAM.\r\n"
            "DEFINE !macro ()\r\n\t!LET !v = !QUOTE('a\tb')\r\n!ENDDEFINE.\r\n"
        )
        normalized, tab_count, tab_lines = BRIDGE_MODULE._normalize_syntax_for_submit(source)
        self.assertEqual(normalized, source.replace("\r\n", "\n"))
        self.assertEqual((tab_count, tab_lines), (0, []))

    def test_old_mac_code_endings_are_normalized_without_modifying_literal_cr(self):
        source = "COMPUTE x=1.\rTITLE 'a\rb'.\rEXECUTE.\r"
        normalized, unused_count, unused_lines = BRIDGE_MODULE._normalize_syntax_for_submit(source)
        self.assertEqual(normalized, "COMPUTE x=1.\nTITLE 'a\rb'.\nEXECUTE.\n")

    def test_multiline_and_doubled_quotes_preserve_tabs_and_fake_delimiters(self):
        source = (
            "TITLE 'a''b\n\tBEGIN PROGRAM PYTHON3.\n\tend'.\n"
            'TITLE "a""b\n\tBEGIN DATA\n\tend".\n'
            "\tCOMPUTE x=1.\n"
        )
        normalized, tab_count, tab_lines = BRIDGE_MODULE._normalize_syntax_for_submit(source)
        self.assertEqual(normalized, source.replace("\tCOMPUTE", "    COMPUTE"))
        self.assertEqual((tab_count, tab_lines), (1, [7]))

    def test_multiline_command_comments_do_not_open_embedded_blocks(self):
        source = (
            "/* one-line comment\tunchanged */\n"
            "* comment's unmatched quote\n\tBEGIN DATA\n\tends here.\n"
            "COMMENT another\n\tBEGIN GPL\n\tcomment.\n"
            "\tCOMPUTE x=1.\n"
        )
        normalized, tab_count, tab_lines = BRIDGE_MODULE._normalize_syntax_for_submit(source)
        self.assertEqual(normalized, source.replace("\tCOMPUTE", "    COMPUTE"))
        self.assertEqual((tab_count, tab_lines), (1, [8]))

    def test_unclosed_inline_comment_ends_at_the_physical_line(self):
        for ending in ("\n", "\r\n"):
            source = ending.join((
                "DO IF x=1.", "COMPUTE y=1. /* user's note without a closing marker",
                "COMPUTE\tz=2.", "END IF.", "EXECUTE.",
            ))
            normalized, tab_count, tab_lines = BRIDGE_MODULE._normalize_syntax_for_submit(source)
            self.assertEqual(normalized, source.replace("\r\n", "\n").replace("COMPUTE\tz", "COMPUTE z"))
            self.assertEqual((tab_count, tab_lines), (1, [3]))

    def test_raw_bodies_macro_functions_and_same_line_payload_are_preserved(self):
        source = (
            "DEFINE !m (v=!TOKENS(1))\n\t!LET !v=!CONCAT('a', '\tb')\n!ENDDEFINE.\n"
            "BEGIN PROGRAM PYTHON3.\tprint('inline\tdata')\n\tEND PROGRAM.\n"
            "BEGIN SCRIPT.\n\t'keep script\tdata'\nEND SCRIPT.\n"
            "MATRIX.\n\tCOMPUTE v={1,2}.\nEND MATRIX.\n"
            "BEGIN GPL\n\tSOURCE: s=userSource(id('dataset'))\nEND GPL.\n"
            "BEGIN DATA\n\t1\t2\nEND DATA.\n"
        )
        normalized, tab_count, tab_lines = BRIDGE_MODULE._normalize_syntax_for_submit(source)
        self.assertEqual(normalized, source.replace("\tEND PROGRAM", "    END PROGRAM"))
        self.assertEqual((tab_count, tab_lines), (1, [5]))

    def test_fullwidth_punctuation_and_quoted_non_ascii_text_are_unchanged(self):
        source = "RECODE\u00a0x (1\uff1d0).\nTITLE 'a\u200bb\ufeffc\u2028d'.\n"
        normalized, tab_count, tab_lines = BRIDGE_MODULE._normalize_syntax_for_submit(source)
        self.assertEqual(normalized, source.replace("RECODE\u00a0", "RECODE "))
        self.assertEqual((tab_count, tab_lines), (0, []))

    def test_only_verified_code_separators_are_normalized(self):
        source = (
            "RECODE\tx\u00a0(1=0)\u3000INTO y.\n"
            "TITLE 'keep\t\u00a0\u3000'. /* keep\t\u00a0\u3000 */\n"
            "COMPUTE z=!QUOTE(a\tb).\n"
            "\tEXECUTE.\n"
        )
        normalized, tab_count, tab_lines = BRIDGE_MODULE._normalize_syntax_for_submit(source)
        self.assertEqual(normalized, source.replace("RECODE\tx\u00a0(1=0)\u3000", "RECODE x (1=0) ")
                         .replace("\tEXECUTE", "    EXECUTE"))
        self.assertEqual((tab_count, tab_lines), (2, [1, 4]))

    def test_run_reports_locations_without_echoing_source_and_submits_once(self):
        fake = FakeSpss()
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        with tempfile.TemporaryDirectory() as output_root:
            response = bridge.run("COMPUTE sensitive_name=1.\r\nRECODE\u00a0x (1\uff1d0).", output_root, "eol")
        self.assertEqual(fake.submissions[1], "COMPUTE sensitive_name=1.\nRECODE x (1\uff1d0).")
        self.assertEqual(len(fake.submissions), 3)
        warning_text = " ".join(response["warnings"])
        self.assertNotIn("U+000D", warning_text)
        self.assertIn("line 2, column 7", warning_text)
        self.assertIn("U+00A0 NO-BREAK SPACE", warning_text)
        self.assertIn("U+FF1D FULLWIDTH EQUALS SIGN", warning_text)
        self.assertNotIn("sensitive_name", warning_text)

    def test_normal_crlf_is_silent_and_does_not_retry_a_failed_run(self):
        fake = FakeSpss()
        fake.raise_on_user = "deliberate syntax failure"
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        with tempfile.TemporaryDirectory() as output_root:
            response = bridge.run("COMPUTE x=1.\r\nEXECUTE.\r\n", output_root, "crlf")
        self.assertEqual(response["warnings"], [])
        self.assertEqual(fake.submissions[1], "COMPUTE x=1.\nEXECUTE.\n")
        self.assertEqual(len(fake.submissions), 3)
        self.assertEqual(response["status"], "ERROR")

    def test_embedded_closing_delimiter_must_match_the_opening_language(self):
        source = "BEGIN SCRIPT.\nEND GPL.\n\tunchanged\nEND SCRIPT.\n\tEXECUTE.\n"
        normalized, tab_count, tab_lines = BRIDGE_MODULE._normalize_syntax_for_submit(source)
        self.assertEqual(normalized, source.replace("\tEXECUTE", "    EXECUTE"))
        self.assertEqual((tab_count, tab_lines), (1, [5]))

    def test_suspect_characters_are_reported_only_in_code_with_bounded_locations(self):
        source = (
            "TITLE 'keep\u200b\ufeff\uff1d'. /* keep\u200b\ufeff\uff1d */\n"
            "BEGIN DATA\n1\u200b\ufeff\uff1d\nEND DATA.\n"
            "COMPUTE x\u200b=\ufeff1\uff1d2\u2060+3\u200c+4.\n"
        )
        normalized, tab_count, tab_lines, warnings, endings = BRIDGE_MODULE._prepare_syntax_for_submit(source)
        self.assertEqual(normalized, source)
        self.assertEqual((tab_count, tab_lines, endings), (0, [], 0))
        self.assertEqual(len(warnings), 1)
        self.assertIn("5 syntax characters", warnings[0])
        self.assertIn("further locations omitted", warnings[0])
        self.assertNotIn("line 1", warnings[0])
        self.assertNotIn("line 3", warnings[0])


class TextImportCachingTests(unittest.TestCase):
    def submit(self, syntax: str) -> str:
        fake = FakeSpss()
        with tempfile.TemporaryDirectory() as output_root:
            response = BRIDGE_MODULE.SpssBridge(fake).run(syntax, output_root, "text-import")
        self.assertTrue(response["ok"])
        self.assertEqual(len(fake.submissions), 3)
        return fake.submissions[1]

    def test_materializes_each_text_import_before_the_following_user_command(self) -> None:
        first = 'get data\r\n /type = TXT\r\n /file="a.csv"\r\n /variables=id A10.0. /* source comment */'
        second = 'GET DATA /TYPE=TXT /FILE="b.csv" /VARIABLES=id F8.0.'
        user_syntax = first + "\r\nTEMPORARY.\r\nSELECT IF (id=\"1\").\r\n" + second
        expected = (
            first.replace("\r\n", "\n") + "\nCACHE.\nEXECUTE.\nTEMPORARY.\nSELECT IF (id=\"1\").\n"
            + second + "\nCACHE.\nEXECUTE.\n"
        )
        self.assertEqual(self.submit(user_syntax), expected)

    def test_ignores_quoted_commented_embedded_and_nontext_imports(self) -> None:
        text = (
            'TITLE "GET DATA /TYPE=TXT".\n'
            '* GET DATA /TYPE=TXT /FILE="comment.csv".\n'
            'GET DATA /TYPE=XLSX /FILE="GET DATA /TYPE=TXT.xlsx".\n'
            'BEGIN PROGRAM PYTHON3.\n'
            'spss.Submit(\'GET DATA /TYPE=TXT /FILE="example.csv".\')\n'
            'END PROGRAM.\n'
            'DEFINE !example().\n'
            'GET DATA /TYPE=TXT /FILE="macro.csv" /VARIABLES=id A10.0.\n'
            '!ENDDEFINE.\n'
            'GET FILE "other.sav".'
        )
        self.assertEqual(self.submit(text), text)

    def test_reuses_an_explicit_immediate_cache_and_execute(self) -> None:
        load = 'GET DATA /TYPE=TXT /FILE="a.csv" /VARIABLES=id A10.0.\n'
        self.assertEqual(self.submit(load + "CACHE.\nEXECUTE."), load + "CACHE.\nEXECUTE.")
        self.assertEqual(self.submit(load + "EXECUTE."), load + "CACHE.\nEXECUTE.")


if __name__ == "__main__":
    unittest.main()
