#!/usr/bin/env python3
"""Persistent JSONL bridge between VS Code and IBM SPSS Statistics."""

import json
import datetime
import math
import os
import re
import sys
import time
import traceback
import uuid
from contextlib import redirect_stdout


def _quote_spss_string(value):
    return "'{}'".format(value.replace("'", "''"))


_PROTECTED_BLOCKS = (
    (re.compile(r"^\s*BEGIN\s+DATA(?:\s|\.|$)", re.IGNORECASE), re.compile(r"^\s*END\s+DATA(?:\s|\.|$)", re.IGNORECASE)),
    (re.compile(r"^\s*BEGIN\s+PROGRAM(?:\s|\.|$)", re.IGNORECASE), re.compile(r"^\s*END\s+PROGRAM(?:\s|\.|$)", re.IGNORECASE)),
    (re.compile(r"^\s*BEGIN\s+GPL(?:\s|\.|$)", re.IGNORECASE), re.compile(r"^\s*END\s+GPL(?:\s|\.|$)", re.IGNORECASE)),
    (re.compile(r"^\s*BEGIN\s+SCRIPT(?:\s|\.|$)", re.IGNORECASE), re.compile(r"^\s*END\s+SCRIPT(?:\s|\.|$)", re.IGNORECASE)),
    (re.compile(r"^\s*MATRIX\s*\.?\s*$", re.IGNORECASE), re.compile(r"^\s*END\s+MATRIX(?:\s|\.|$)", re.IGNORECASE)),
)


def _expand_leading_tabs(line):
    indentation = re.match(r"^[ \t]+", line)
    if indentation is None:
        return line, 0
    prefix = indentation.group(0)
    tab_count = prefix.count("\t")
    if tab_count == 0:
        return line, 0
    return prefix.expandtabs(4) + line[len(prefix):], tab_count


def _normalize_syntax_for_submit(syntax):
    """Expand command-indentation tabs that SPSS Submit rejects.

    Literal data and embedded-language bodies remain byte-for-byte unchanged.
    Block delimiter lines are SPSS commands, so their indentation is normalized.
    """
    normalized_lines = []
    changed_lines = []
    tab_count = 0
    protected_end = None
    for line_number, line in enumerate(syntax.splitlines(keepends=True), start=1):
        line_without_ending = line.rstrip("\r\n")
        if protected_end is not None and protected_end.match(line_without_ending) is None:
            normalized_lines.append(line)
            continue

        normalized_line, changed_tabs = _expand_leading_tabs(line)
        normalized_lines.append(normalized_line)
        if changed_tabs:
            tab_count += changed_tabs
            changed_lines.append(line_number)

        normalized_without_ending = normalized_line.rstrip("\r\n")
        if protected_end is not None:
            protected_end = None
            continue
        for block_start, block_end in _PROTECTED_BLOCKS:
            if block_start.match(normalized_without_ending):
                protected_end = block_end
                break

    return "".join(normalized_lines), tab_count, changed_lines


class SpssBridge(object):
    def __init__(self, spss_module, debug=False):
        self.spss = spss_module
        self.debug = debug
        self.started = False
        self.last_error = None

    def _diagnostic(self, message):
        if self.debug:
            sys.stderr.write("{}\n".format(message))
            sys.stderr.flush()

    def _invoke(self, function, *args, **kwargs):
        # Protect stdout because it is reserved exclusively for JSONL responses.
        with redirect_stdout(sys.stderr):
            return function(*args, **kwargs)

    def start(self):
        if self.started:
            return
        self._diagnostic("Starting IBM SPSS Statistics processor")
        self._invoke(self.spss.StartSPSS)
        self.started = True
        self.last_error = None

    def _error_level(self):
        try:
            return int(self._invoke(self.spss.GetLastErrorLevel))
        except Exception as exc:  # SPSS may already have terminated.
            self.started = False
            self.last_error = str(exc)
            return 3

    def _last_error(self):
        try:
            level = int(self._invoke(self.spss.GetLastErrorLevel))
            message = self._invoke(self.spss.GetLastErrorMessage)
            return level, str(message or "")
        except Exception as exc:  # SPSS may already have terminated.
            self.started = False
            self.last_error = str(exc)
            return 5, self.last_error

    def _variable_metadata(self, index):
        variable_type = int(self._invoke(self.spss.GetVariableType, index))
        metadata = {
            "index": index,
            "name": str(self._invoke(self.spss.GetVariableName, index)),
            "label": str(self._invoke(self.spss.GetVariableLabel, index) or ""),
            "type": "Numeric" if variable_type == 0 else "String ({})".format(variable_type),
            "format": str(self._invoke(self.spss.GetVariableFormat, index) or ""),
        }
        try:
            level = self._invoke(self.spss.GetVariableMeasurementLevel, index)
            if level is not None:
                metadata["measurementLevel"] = str(level)
        except Exception as exc:
            self._diagnostic("Measurement level unavailable for variable {}: {}".format(index, exc))
        return metadata

    def dataset_info(self):
        self.start()
        started_at = time.monotonic()
        try:
            variable_count = int(self._invoke(self.spss.GetVariableCount))
            case_count = int(self._invoke(self.spss.GetCaseCount))
            dataset_name = str(self._invoke(self.spss.ActiveDataset) or "*")
        except Exception:
            return {
                "ok": True,
                "errorLevel": 0,
                "output": "",
                "warnings": [],
                "error": None,
                "durationMs": int(round((time.monotonic() - started_at) * 1000)),
                "engineAlive": self.started,
                "datasetInfo": {
                    "active": False,
                    "datasetName": "",
                    "caseCount": 0,
                    "variableCount": 0,
                    "variables": [],
                },
            }

        variables = [self._variable_metadata(index) for index in range(variable_count)]
        info = {
            "active": True,
            "datasetName": dataset_name,
            "caseCount": case_count,
            "variableCount": variable_count,
            "variables": variables,
        }
        try:
            weight = self._invoke(self.spss.GetWeightVar)
            if weight:
                info["weightVariable"] = str(weight)
        except Exception as exc:
            self._diagnostic("Weight metadata unavailable: {}".format(exc))
        try:
            split = self._invoke(self.spss.GetSplitVariableNames)
            if split:
                info["splitVariables"] = [str(value) for value in split]
        except Exception as exc:
            self._diagnostic("Split metadata unavailable: {}".format(exc))
        if hasattr(self.spss, "GetFilterVariable"):
            try:
                filter_variable = self._invoke(self.spss.GetFilterVariable)
                if filter_variable:
                    info["filterVariable"] = str(filter_variable)
            except Exception as exc:
                self._diagnostic("Filter metadata unavailable: {}".format(exc))
        return {
            "ok": True,
            "errorLevel": 0,
            "output": "",
            "warnings": [],
            "error": None,
            "durationMs": int(round((time.monotonic() - started_at) * 1000)),
            "engineAlive": self.started,
            "datasetInfo": info,
        }

    @staticmethod
    def _json_cell(value):
        if value is None or isinstance(value, (str, bool, int)):
            return value
        if isinstance(value, float):
            return value if math.isfinite(value) else str(value)
        if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
            return value.isoformat(sep=" ") if isinstance(value, datetime.datetime) else value.isoformat()
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return str(value)

    def dataset_page(self, offset, limit, variable_start, variable_limit):
        self.start()
        started_at = time.monotonic()
        info_response = self.dataset_info()
        info = info_response["datasetInfo"]
        if not info["active"]:
            raise ValueError("No Active Dataset is available.")
        safe_offset = max(0, int(offset))
        safe_limit = min(500, max(1, int(limit)))
        safe_variable_start = max(0, int(variable_start))
        safe_variable_limit = min(200, max(1, int(variable_limit)))
        variable_end = min(info["variableCount"], safe_variable_start + safe_variable_limit)
        total_cases = info["caseCount"]
        rows = []
        dataset_object = None
        data_step_started = False
        original_name = info["datasetName"]
        restore_name = original_name if original_name != "*" and re.match(r"^[A-Za-z@#$][A-Za-z0-9_@#$]*$", original_name) else None
        try:
            self._invoke(self.spss.StartDataStep)
            data_step_started = True
            dataset_object = self._invoke(self.spss.Dataset, cvtDates=True)
            if total_cases < 0:
                total_cases = len(dataset_object.cases)
            case_end = min(total_cases, safe_offset + safe_limit)
            if case_end > safe_offset and variable_end > safe_variable_start:
                values = dataset_object.cases[
                    slice(safe_offset, case_end),
                    slice(safe_variable_start, variable_end),
                ]
                rows = [[self._json_cell(value) for value in row] for row in values]
        finally:
            if dataset_object is not None and hasattr(dataset_object, "close"):
                self._invoke(dataset_object.close)
            if data_step_started:
                self._invoke(self.spss.EndDataStep)
            if restore_name is not None:
                self._invoke(self.spss.Submit, "DATASET NAME {}.".format(restore_name))
        return {
            "ok": True,
            "errorLevel": 0,
            "output": "",
            "warnings": [],
            "error": None,
            "durationMs": int(round((time.monotonic() - started_at) * 1000)),
            "engineAlive": self.started,
            "datasetPage": {
                "datasetName": info["datasetName"],
                "totalCases": total_cases,
                "totalVariables": info["variableCount"],
                "offset": safe_offset,
                "limit": safe_limit,
                "variableStart": safe_variable_start,
                "variableLimit": safe_variable_limit,
                "variables": info["variables"][safe_variable_start:variable_end],
                "rows": rows,
            },
        }

    def run(self, syntax, output_directory, run_id):
        self.start()
        started_at = time.monotonic()
        tag = "__SPSS_STUDIO_{}".format(uuid.uuid4().hex.upper())
        os.makedirs(output_directory, exist_ok=True)
        output_path = os.path.join(output_directory, "output.html")
        oms_active = False
        warnings = []
        primary_error = None
        capture_error = None
        error_level = 0
        error_message = ""

        oms_command = (
            "OMS\n"
            " /TAG={tag}\n"
            " /SELECT ALL\n"
            " /DESTINATION FORMAT=HTML OUTFILE={outfile} VIEWER=NO"
            " IMAGES=YES IMAGEFORMAT=PNG."
        ).format(tag=_quote_spss_string(tag), outfile=_quote_spss_string(output_path))
        oms_end = "OMSEND TAG=[{}].".format(_quote_spss_string(tag))
        submitted_syntax, normalized_tabs, normalized_lines = _normalize_syntax_for_submit(syntax)
        if normalized_tabs:
            warnings.append(
                "Normalized {} leading tab character{} before SPSS submission (lines {}).".format(
                    normalized_tabs,
                    "" if normalized_tabs == 1 else "s",
                    ", ".join(str(line) for line in normalized_lines),
                )
            )

        try:
            try:
                self._invoke(self.spss.Submit, oms_command)
                oms_active = True
            except Exception as exc:
                capture_error = "OMS capture could not start: {}".format(exc)
                warnings.append(capture_error)

            try:
                # Normalize only command indentation required by the Submit API.
                # Literal data, embedded code, and all other text remain unchanged.
                self._invoke(self.spss.Submit, submitted_syntax)
                error_level, error_message = self._last_error()
            except Exception as exc:
                primary_error = str(exc)
                self.last_error = primary_error
                error_level, error_message = self._last_error()
        finally:
            if oms_active:
                try:
                    self._invoke(self.spss.Submit, oms_end)
                except Exception as exc:
                    capture_error = "OMS capture could not close: {}".format(exc)
                    warnings.append(capture_error)
            output_created = os.path.isfile(output_path) and os.path.getsize(output_path) > 0

        duration_ms = int(round((time.monotonic() - started_at) * 1000))
        reported_message = error_message if error_level > 0 else ""
        effective_error = primary_error or reported_message or (self.last_error if not self.started else None) or capture_error
        if not self.started:
            status = "ENGINE_ERROR"
        elif primary_error is not None or error_level >= 3:
            status = "ERROR"
        elif capture_error is not None:
            status = "ENGINE_ERROR"
        elif error_level == 2:
            status = "WARNING"
        elif output_created:
            status = "SUCCESS"
        else:
            status = "SUCCESS_NO_OUTPUT"
        ok = status in ("SUCCESS", "SUCCESS_NO_OUTPUT", "WARNING")
        if ok:
            self.last_error = None
        return {
            "ok": ok,
            "errorLevel": error_level,
            "output": "",
            "warnings": warnings,
            "error": effective_error or None,
            "durationMs": duration_ms,
            "engineAlive": self.started,
            "status": status,
            "htmlPath": output_path if output_created else None,
            "runId": run_id,
        }

    def status(self):
        alive = self.started
        error_level = 0
        if alive:
            error_level = self._error_level()
            alive = self.started
        return {
            "ok": alive,
            "errorLevel": error_level,
            "output": "",
            "warnings": [],
            "error": self.last_error,
            "durationMs": 0,
            "engineAlive": alive,
        }

    def shutdown(self):
        error = None
        if self.started:
            try:
                self._invoke(self.spss.StopSPSS)
            except Exception as exc:
                error = str(exc)
            finally:
                self.started = False
        return {
            "ok": error is None,
            "errorLevel": 0 if error is None else 3,
            "output": "",
            "warnings": [],
            "error": error,
            "durationMs": 0,
            "engineAlive": False,
        }

    def handle(self, request):
        request_id = request.get("id")
        operation = request.get("op")
        if not isinstance(request_id, str) or not request_id:
            raise ValueError("Request id must be a non-empty string.")
        if operation == "ping":
            self.start()
            response = self.status()
        elif operation == "status":
            response = self.status()
        elif operation == "run":
            syntax = request.get("syntax")
            if not isinstance(syntax, str):
                raise ValueError("Run request syntax must be a string.")
            output_directory = request.get("outputDirectory")
            run_id = request.get("runId")
            if not isinstance(output_directory, str) or not output_directory:
                raise ValueError("Run request outputDirectory must be a non-empty string.")
            if not isinstance(run_id, str) or not run_id:
                raise ValueError("Run request runId must be a non-empty string.")
            response = self.run(syntax, output_directory, run_id)
        elif operation == "datasetInfo":
            response = self.dataset_info()
        elif operation == "datasetPage":
            response = self.dataset_page(
                request.get("offset", 0),
                request.get("limit", 100),
                request.get("variableStart", 0),
                request.get("variableLimit", 50),
            )
        elif operation == "shutdown":
            response = self.shutdown()
        else:
            raise ValueError("Unsupported operation: {}".format(operation))
        response["id"] = request_id
        return response


def _failure_response(request_id, error, duration_ms=0):
    return {
        "id": request_id,
        "ok": False,
        "errorLevel": 3,
        "output": "",
        "warnings": [],
        "error": error,
        "durationMs": duration_ms,
    }


def main():
    debug = os.environ.get("SPSS_STUDIO_DEBUG") == "1"
    import_error = None
    bridge = None
    try:
        import spss  # pylint: disable=import-outside-toplevel
        bridge = SpssBridge(spss, debug=debug)
    except Exception as exc:
        import_error = "Unable to import IBM SPSS Python module: {}".format(exc)
        if debug:
            traceback.print_exc(file=sys.stderr)

    for raw_line in sys.stdin:
        request_id = None
        request = None
        started_at = time.monotonic()
        try:
            request = json.loads(raw_line)
            request_id = request.get("id") if isinstance(request, dict) else None
            if not isinstance(request, dict):
                raise ValueError("Each JSONL request must be an object.")
            if import_error is not None or bridge is None:
                response = _failure_response(request_id, import_error)
            else:
                response = bridge.handle(request)
        except Exception as exc:
            response = _failure_response(
                request_id,
                str(exc),
                int(round((time.monotonic() - started_at) * 1000)),
            )
        sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()
        if isinstance(response, dict) and request_id and isinstance(request, dict):
            if request.get("op") == "shutdown":
                break

    if bridge is not None and bridge.started:
        bridge.shutdown()


if __name__ == "__main__":
    main()
