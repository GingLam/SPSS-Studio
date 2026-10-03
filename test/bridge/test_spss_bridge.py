import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest


BRIDGE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "resources", "bridge", "spss_bridge.py")
)
SPEC = importlib.util.spec_from_file_location("spss_bridge", BRIDGE_PATH)
BRIDGE_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BRIDGE_MODULE)


class FakeSpss(object):
    def __init__(self):
        self.started = False
        self.start_count = 0
        self.stop_count = 0
        self.submissions = []
        self.output_path = None
        self.error_level = 0
        self.error_message = ""
        self.raise_on_user = None
        self.write_output = True
        self.variables = [
            {"name": "age", "label": "Age", "type": 0, "format": "F8.0", "level": "scale", "labels": {}},
            {"name": "group", "label": "Group", "type": 8, "format": "A8", "level": "nominal", "labels": {"A": "Treatment"}},
        ]
        self.rows = [[20.0, "A"], [None, ""]]
        self.data_step_count = 0
        self.dataset_close_count = 0
        self.dataset_name = "DataSet1"

    def StartSPSS(self):
        self.started = True
        self.start_count += 1

    def StopSPSS(self):
        self.started = False
        self.stop_count += 1

    def Submit(self, syntax):
        self.submissions.append(syntax)
        if syntax.startswith("OMS\n"):
            match = re.search(r"OUTFILE='([^']+)'", syntax)
            self.output_path = match.group(1)
        elif syntax.startswith("OMSEND"):
            if self.output_path and self.write_output:
                with open(self.output_path, "w", encoding="utf-8") as output_file:
                    output_file.write("<html><body><table><tr><td>SPSS output</td></tr></table></body></html>")
        elif syntax.startswith("DATASET NAME "):
            self.dataset_name = syntax[len("DATASET NAME "):].rstrip(".")
        elif self.raise_on_user:
            raise RuntimeError(self.raise_on_user)

    def GetLastErrorLevel(self):
        if not self.started:
            raise RuntimeError("processor is not alive")
        return self.error_level

    def GetLastErrorMessage(self):
        return self.error_message

    def GetVariableCount(self):
        return len(self.variables)

    def GetCaseCount(self):
        return len(self.rows)

    def ActiveDataset(self):
        return self.dataset_name

    def GetVariableName(self, index):
        return self.variables[index]["name"]

    def GetVariableLabel(self, index):
        return self.variables[index]["label"]

    def GetVariableType(self, index):
        return self.variables[index]["type"]

    def GetVariableFormat(self, index):
        return self.variables[index]["format"]

    def GetVariableMeasurementLevel(self, index):
        return self.variables[index]["level"]

    def GetWeightVar(self):
        return ""

    def GetVarMissingValues(self, index):
        return (0, "", None, None) if index == 1 else (0, None, None, None)

    def GetSplitVariableNames(self):
        return []

    def StartDataStep(self):
        self.data_step_count += 1

    def EndDataStep(self):
        self.data_step_count -= 1

    def Dataset(self, cvtDates=False):
        owner = self

        class FakeValueLabels(object):
            def __init__(self, values):
                self.data = values

        class FakeVariable(object):
            def __init__(self, values):
                self.valueLabels = FakeValueLabels(values)

        class FakeVarList(object):
            def __getitem__(self, name):
                variable = next(item for item in owner.variables if item["name"] == name)
                return FakeVariable(variable["labels"])

        class FakeCases(object):
            def __getitem__(self, key):
                case_slice, variable_slice = key
                return [row[variable_slice] for row in owner.rows[case_slice]]

        class FakeDataset(object):
            cases = FakeCases()
            varlist = FakeVarList()

            def close(self):
                owner.dataset_close_count += 1
                owner.dataset_name = "*"

        self.cvt_dates = cvtDates
        return FakeDataset()


class SpssBridgeTests(unittest.TestCase):
    def test_normalizes_leading_tabs_only_in_spss_command_regions(self):
        source = (
            "\tEXAMINE VARIABLES=age\n"
            "\t/PLOT NONE.\n"
            "TITLE 'keep\tliteral tab'.\n"
            "\tBEGIN DATA\n"
            "\t1\t2\n"
            "\tEND DATA.\n"
            "\tBEGIN PROGRAM PYTHON3.\n"
            "\tprint('keep program indentation')\n"
            "\tEND PROGRAM.\n"
            "\tBEGIN GPL\n"
            "\tSOURCE: s=userSource(id('dataset'))\n"
            "\tEND GPL.\n"
            "\tMATRIX.\n"
            "\tCOMPUTE values={1,2}.\n"
            "\tEND MATRIX."
        )

        normalized, tab_count, line_numbers = BRIDGE_MODULE._normalize_syntax_for_submit(source)

        self.assertEqual(tab_count, 10)
        self.assertEqual(line_numbers, [1, 2, 4, 6, 7, 9, 10, 12, 13, 15])
        self.assertTrue(normalized.startswith("    EXAMINE VARIABLES=age\n    /PLOT NONE."))
        self.assertIn("TITLE 'keep\tliteral tab'.", normalized)
        self.assertIn("    BEGIN DATA\n\t1\t2\n    END DATA.", normalized)
        self.assertIn("    BEGIN PROGRAM PYTHON3.\n\tprint('keep program indentation')\n    END PROGRAM.", normalized)
        self.assertIn("    BEGIN GPL\n\tSOURCE: s=userSource(id('dataset'))\n    END GPL.", normalized)
        self.assertIn("    MATRIX.\n\tCOMPUTE values={1,2}.\n    END MATRIX.", normalized)

    def test_run_submits_normalized_tabs_and_reports_the_changed_lines(self):
        fake = FakeSpss()
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        syntax = "EXAMINE VARIABLES=age\n\t/PLOT NONE\n\t/CINTERVAL 99."
        with tempfile.TemporaryDirectory() as output_root:
            response = bridge.handle({
                "id": "tabs", "op": "run", "syntax": syntax,
                "runId": "tabs", "outputDirectory": output_root,
            })

        self.assertEqual(fake.submissions[1], "EXAMINE VARIABLES=age\n    /PLOT NONE\n    /CINTERVAL 99.")
        self.assertEqual(
            response["warnings"],
            ["Normalized 2 leading tab characters before SPSS submission (lines 2, 3)."],
        )

    def test_persistent_session_and_oms_cleanup(self):
        fake = FakeSpss()
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        with tempfile.TemporaryDirectory() as output_root:
            first = bridge.handle({
                "id": "one", "op": "run", "syntax": "DESCRIPTIVES VARIABLES=x.",
                "runId": "run-1", "outputDirectory": os.path.join(output_root, "run-1"),
            })
            second = bridge.handle({
                "id": "two", "op": "run", "syntax": "FREQUENCIES VARIABLES=x.",
                "runId": "run-2", "outputDirectory": os.path.join(output_root, "run-2"),
            })

        self.assertTrue(first["ok"])
        self.assertEqual(first["status"], "SUCCESS")
        self.assertTrue(first["htmlPath"].endswith("output.html"))
        self.assertTrue(second["ok"])
        self.assertEqual(fake.start_count, 1)
        self.assertRegex(fake.submissions[0], r"/TAG='__SPSS_STUDIO_[0-9A-F]+'");
        self.assertIn("FORMAT=HTML", fake.submissions[0])
        self.assertIn("VIEWER=NO", fake.submissions[0])
        self.assertIn("IMAGES=YES IMAGEFORMAT=PNG", fake.submissions[0])
        self.assertRegex(fake.submissions[2], r"OMSEND TAG=\['__SPSS_STUDIO_[0-9A-F]+'\]\.")
        self.assertNotEqual(fake.submissions[2], "OMSEND.")

    def test_reports_spss_error_without_hiding_oms_output(self):
        fake = FakeSpss()
        fake.raise_on_user = "SPSS syntax failed"
        fake.error_level = 3
        fake.error_message = "Undefined variable"
        with tempfile.TemporaryDirectory() as output_root:
            response = BRIDGE_MODULE.SpssBridge(fake).handle({
                "id": "bad", "op": "run", "syntax": "INVALID COMMAND.",
                "runId": "bad", "outputDirectory": output_root,
            })
        self.assertFalse(response["ok"])
        self.assertEqual(response["errorLevel"], 3)
        self.assertEqual(response["status"], "ERROR")
        self.assertEqual(response["error"], "SPSS syntax failed")
        self.assertTrue(response["htmlPath"].endswith("output.html"))

    def test_success_without_display_output_is_not_an_error(self):
        fake = FakeSpss()
        fake.write_output = False
        with tempfile.TemporaryDirectory() as output_root:
            response = BRIDGE_MODULE.SpssBridge(fake).handle({
                "id": "quiet", "op": "run", "syntax": "COMPUTE x=1.",
                "runId": "quiet", "outputDirectory": output_root,
            })
        self.assertTrue(response["ok"])
        self.assertEqual(response["status"], "SUCCESS_NO_OUTPUT")
        self.assertIsNone(response["htmlPath"])

    def test_dataset_info_and_range_page(self):
        fake = FakeSpss()
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        info = bridge.handle({"id": "info", "op": "datasetInfo"})["datasetInfo"]
        page = bridge.handle({
            "id": "page", "op": "datasetPage", "offset": 0, "limit": 1,
            "variableStart": 0, "variableLimit": 2,
        })["datasetPage"]
        self.assertEqual(info["datasetName"], "DataSet1")
        self.assertEqual(info["caseCount"], 2)
        self.assertEqual(info["variables"][1]["type"], "String (8)")
        self.assertEqual(page["rows"], [[20.0, "A"]])
        self.assertEqual(page["offset"], 0)
        self.assertEqual(page["limit"], 1)
        self.assertTrue(fake.cvt_dates)
        self.assertEqual(fake.data_step_count, 0)
        self.assertEqual(fake.dataset_close_count, 1)
        self.assertEqual(fake.ActiveDataset(), "DataSet1")

    def test_variable_profiles_are_bounded_read_only_summaries(self):
        fake = FakeSpss()
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        response = bridge.handle({
            "id": "profiles", "op": "variableProfiles", "variableNames": ["age", "group"],
        })
        profiles = response["variableProfiles"]["profiles"]

        self.assertEqual([profile["name"] for profile in profiles], ["age", "group"])
        self.assertEqual(profiles[0]["summary"]["kind"], "continuous")
        self.assertEqual(profiles[0]["summary"]["validN"], 1)
        self.assertEqual(profiles[0]["summary"]["missingN"], 1)
        self.assertEqual(profiles[0]["summary"]["mean"], 20.0)
        self.assertEqual(profiles[1]["summary"]["kind"], "categorical")
        self.assertEqual(profiles[1]["summary"]["topValues"], [
            {"value": "A", "frequency": 1, "label": "Treatment"},
        ])
        self.assertEqual(profiles[1]["valueLabels"], [{"value": "A", "label": "Treatment"}])
        self.assertFalse(fake.cvt_dates)
        self.assertEqual(fake.data_step_count, 0)
        self.assertEqual(fake.dataset_close_count, 1)
        self.assertEqual(fake.ActiveDataset(), "DataSet1")

    def test_variable_profiles_validate_names_and_limit(self):
        bridge = BRIDGE_MODULE.SpssBridge(FakeSpss())
        with self.assertRaisesRegex(ValueError, "Unknown Active Dataset variable"):
            bridge.handle({"id": "missing", "op": "variableProfiles", "variableNames": ["missing"]})
        with self.assertRaisesRegex(ValueError, "between 1 and 20"):
            bridge.handle({
                "id": "many", "op": "variableProfiles",
                "variableNames": ["v{}".format(index) for index in range(21)],
            })

    def test_user_missing_value_formats_follow_spss_module_contract(self):
        bridge = BRIDGE_MODULE.SpssBridge(FakeSpss())

        self.assertTrue(bridge._is_missing(9, (0, 0, 9, 99)))
        self.assertFalse(bridge._is_missing(5, (0, 0, 9, 99)))
        self.assertTrue(bridge._is_missing(50, (1, 9, 99, None)))
        self.assertFalse(bridge._is_missing(8, (1, 9, 99, None)))
        self.assertTrue(bridge._is_missing(50, (2, 9, 99, 0)))
        self.assertTrue(bridge._is_missing(0, (2, 9, 99, 0)))
        self.assertFalse(bridge._is_missing(8, (2, 9, 99, 0)))

    def test_ping_status_and_shutdown(self):
        fake = FakeSpss()
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        self.assertTrue(bridge.handle({"id": "ping", "op": "ping"})["engineAlive"])
        self.assertTrue(bridge.handle({"id": "status", "op": "status"})["engineAlive"])
        self.assertFalse(bridge.handle({"id": "stop", "op": "shutdown"})["engineAlive"])
        self.assertEqual(fake.stop_count, 1)

    def test_rejects_malformed_requests(self):
        fake = FakeSpss()
        bridge = BRIDGE_MODULE.SpssBridge(fake)
        with self.assertRaisesRegex(ValueError, "syntax must be a string"):
            bridge.handle({"id": "bad", "op": "run", "syntax": 42})

    def test_jsonl_main_loop_with_mock_module(self):
        with tempfile.TemporaryDirectory() as module_directory:
            fake_module = os.path.join(module_directory, "spss.py")
            with open(fake_module, "w", encoding="utf-8") as module_file:
                module_file.write(
                    "alive = False\n"
                    "def StartSPSS():\n    global alive\n    alive = True\n"
                    "def StopSPSS():\n    global alive\n    alive = False\n"
                    "def GetLastErrorLevel():\n    return 0 if alive else 3\n"
                    "def Submit(syntax):\n    return None\n"
                )
            environment = dict(os.environ)
            environment["PYTHONPATH"] = module_directory
            requests = "\n".join(
                json.dumps(request)
                for request in [
                    {"id": "ping", "op": "ping"},
                    {"id": "status", "op": "status"},
                    {"id": "stop", "op": "shutdown"},
                ]
            ) + "\n"
            completed = subprocess.run(
                [sys.executable, BRIDGE_PATH],
                input=requests,
                text=True,
                capture_output=True,
                env=environment,
                check=True,
            )
            responses = [json.loads(line) for line in completed.stdout.splitlines()]
            self.assertEqual([response["id"] for response in responses], ["ping", "status", "stop"])
            self.assertTrue(responses[0]["engineAlive"])
            self.assertEqual(completed.stderr, "")


if __name__ == "__main__":
    unittest.main()
