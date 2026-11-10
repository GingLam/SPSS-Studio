#!/usr/bin/env python3
"""Persistent JSONL bridge between VS Code and IBM SPSS Statistics."""

import json
import io
import datetime
import math
import os
import re
import sys
import time
import traceback
import unicodedata
import uuid
from collections import Counter
from contextlib import redirect_stdout


def _configure_utf8_stdio() -> None:
    for name, errors in (("stdin", "strict"), ("stdout", "strict"), ("stderr", "backslashreplace")):
        stream = getattr(sys, name)
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors=errors)
        elif hasattr(stream, "detach") and hasattr(stream, "buffer"):
            # SPSS 26's Python 3.4 has no TextIOWrapper.reconfigure().
            setattr(sys, name, io.TextIOWrapper(
                stream.detach(), encoding="utf-8", errors=errors, line_buffering=True,
            ))


def _quote_spss_string(value):
    return "'{}'".format(value.replace("'", "''"))


def _syntax_block_patterns(begin: str, end: str, language: bool = False) -> tuple:
    spaces = r"[ \t\u00a0\u3000]"
    opening = (spaces + "+").join(begin.split(" "))
    closing = (spaces + "+").join(end.split(" "))
    if language:
        opening += r"(?:{0}+[A-Z][A-Z0-9_]*)?".format(spaces)
    return (
        re.compile(opening + spaces + r"*(?:\.|$)", re.IGNORECASE),
        re.compile("^" + spaces + "*" + closing + spaces + r"*\.?" + spaces + "*$", re.IGNORECASE),
    )


_PROTECTED_BLOCKS = (
    _syntax_block_patterns("BEGIN DATA", "END DATA"),
    _syntax_block_patterns("BEGIN PROGRAM", "END PROGRAM", language=True),
    _syntax_block_patterns("BEGIN GPL", "END GPL"),
    _syntax_block_patterns("BEGIN SCRIPT", "END SCRIPT"),
    _syntax_block_patterns("BEGIN EXPR", "END EXPR"),
    _syntax_block_patterns("MATRIX", "END MATRIX"),
    (re.compile(r"DEFINE(?=[ \t]|$)", re.IGNORECASE), re.compile(r"^[ \t]*!ENDDEFINE\.[ \t]*$", re.IGNORECASE)),
)


_VIRTUAL_TEXT_IMPORT = re.compile(
    r"^GET\s+DATA(?:\s*/\s*|\s+)TYPE(?:\s*=\s*|\s+)TXT(?=[\s/.]|$)", re.IGNORECASE,
)
_IMMEDIATE_EXECUTE = re.compile(r"\s*EXECUTE\s*\.(?=\s|/\*|$)", re.IGNORECASE)
_IMMEDIATE_CACHE = re.compile(r"\s*CACHE\s*\.(?=\s|/\*|$)", re.IGNORECASE)


def _text_import_cache_commands(syntax: str, next_line: int) -> str:
    # CACHE schedules a pass; EXECUTE is necessary unless the user already
    # starts a pass here. Never postpone it beyond later user transformations.
    cache = _IMMEDIATE_CACHE.match(syntax, next_line)
    if cache and _IMMEDIATE_EXECUTE.match(syntax, cache.end()):
        return ""
    if _IMMEDIATE_EXECUTE.match(syntax, next_line):
        return "CACHE.\n"
    return "CACHE.\nEXECUTE.\n"


def _syntax_character_location(character: str, line: int, column: int) -> str:
    name = {"\r": "CARRIAGE RETURN", "\t": "CHARACTER TABULATION"}.get(character)
    return "U+{0:04X} {1} at line {2}, column {3}".format(
        ord(character), name or unicodedata.name(character, "UNNAMED"), line, column,
    )


def _is_command_end(line: str, index: int) -> bool:
    tail = line[index + 1:].lstrip(" \t\u00a0\u3000")
    previous = line[:index].rstrip(" \t\u00a0\u3000")
    return (not tail or tail.startswith("/*")) and bool(previous) and previous[-1] not in "=,(+-*/<>&|~"


def _prepare_syntax_for_submit(syntax: str, cache_text_imports: bool = False) -> tuple:
    """Normalize verified Submit separators without changing literal payloads.

    CRLF is a physical line ending in every region. A lone CR inside a quoted
    value or opaque body is ambiguous and is retained. Unsupported characters
    are diagnosed, never guessed or deleted. Source files are never rewritten.
    """
    normalized_lines = []
    changed_lines = []
    tab_count = 0
    changes = {"count": 0, "samples": []}
    suspects = {"count": 0, "samples": []}
    normalized_endings = 0
    protected_end = None
    quote = None
    block_comment = False
    command_comment = False
    command_start = True
    macro_reference = False
    visible_prefix = ""

    def remember(character: str) -> None:
        nonlocal visible_prefix
        if not cache_text_imports or len(visible_prefix) >= 128:
            return
        if character.isspace():
            if visible_prefix and not visible_prefix.endswith(" "):
                visible_prefix += " "
        else:
            visible_prefix += character

    def record(collection: dict, character: str, line: int, column: int) -> None:
        collection["count"] += 1
        if len(collection["samples"]) < 4:
            collection["samples"].append(_syntax_character_location(character, line, column))

    # str.splitlines also treats U+0085/U+2028 as line endings, which would
    # silently corrupt literal data. Only physical CR/LF boundaries belong here.
    lines = re.finditer(r"[^\r\n]*(?:\r\n|\r|\n|$)", syntax)
    for line_number, match in enumerate(lines, start=1):
        raw_line = match.group(0)
        if not raw_line:
            continue
        ending = "\r\n" if raw_line.endswith("\r\n") else raw_line[-1:] if raw_line.endswith(("\r", "\n")) else ""
        line = raw_line[:-len(ending)] if ending else raw_line
        output = []
        index = 0
        line_tabs = 0
        indentation = True
        cache_commands = ""
        if protected_end is not None and protected_end.match(line):
            protected_end = None
            command_start = True
        while index < len(line) and protected_end is None:
            character = line[index]
            following = line[index + 1:index + 2]
            if quote is not None:
                output.append(character)
                if character == quote:
                    if following == quote:
                        output.append(following)
                        index += 1
                    else:
                        quote = None
                index += 1
                continue
            if block_comment:
                output.append(character)
                if character == "*" and following == "/":
                    output.append(following)
                    block_comment = False
                    index += 1
                index += 1
                continue
            if command_comment:
                output.append(character)
                if character == "." and not line[index + 1:].strip(" \t\u00a0\u3000"):
                    command_comment = False
                    command_start = True
                    visible_prefix = ""
                index += 1
                continue
            if character == "/" and following == "*":
                remember(" ")
                output.extend((character, following))
                block_comment = True
                index += 2
                continue
            if command_start and (character == "*" or re.match(r"COMMENT(?:[ \t\u00a0\u3000]|\.|$)", line[index:], re.IGNORECASE)):
                command_comment = True
                continue
            if character in " \t\u00a0\u3000":
                remember(" ")
                if character != " " and not macro_reference:
                    # Preserve the historical four-column command indentation;
                    # an internal TAB is a single token separator.
                    replacement = " " * (4 - len("".join(output)) % 4) if character == "\t" and indentation else " "
                    output.append(replacement)
                    record(changes, character, line_number, index + 1)
                    if character == "\t":
                        tab_count += 1
                        line_tabs += 1
                else:
                    output.append(character)
                index += 1
                continue
            indentation = False
            if command_start:
                for block_start, block_end in _PROTECTED_BLOCKS:
                    opening = block_start.match(line, index)
                    if opening:
                        header = line[index:opening.end()]
                        # DEFINE headers and body use the macro tokenizer. The
                        # other opening delimiters are ordinary SPSS commands.
                        if header.upper().startswith("DEFINE"):
                            output.append(header)
                        else:
                            for offset, item in enumerate(header):
                                if item in "\t\u00a0\u3000":
                                    output.append(" ")
                                    record(changes, item, line_number, index + offset + 1)
                                    if item == "\t":
                                        tab_count += 1
                                        line_tabs += 1
                                else:
                                    output.append(item)
                        index = opening.end()
                        protected_end = block_end
                        visible_prefix = ""
                        break
                if protected_end is not None:
                    break
            command_start = False
            remember("?" if character in ("'", '"') else character)
            if character in ("'", '"'):
                quote = character
            elif character == "!":
                # Macro arguments can consume whitespace as literal text.
                macro_reference = True
            elif character == "." and _is_command_end(line, index):
                if not macro_reference and _VIRTUAL_TEXT_IMPORT.match(visible_prefix):
                    cache_commands = _text_import_cache_commands(syntax, match.end())
                visible_prefix = ""
                command_start = True
                macro_reference = False
            elif not macro_reference and (character.isspace() or character in "\u200b\u200c\u200d\u2060\ufeff\u2018\u2019\u201c\u201d" or ("\uff01" <= character <= "\uff65" and unicodedata.category(character)[0] in "PS")):
                record(suspects, character, line_number, index + 1)
            output.append(character)
            index += 1
        if index < len(line):
            output.append(line[index:])
        if line_tabs:
            changed_lines.append(line_number)
        if ending == "\r\n" or (ending == "\r" and protected_end is None and quote is None):
            normalized_endings += 1
            ending = "\n"
        normalized_lines.append("".join(output) + ending)
        if cache_commands:
            if not ending:
                normalized_lines.append("\n")
            normalized_lines.append(cache_commands)
        if protected_end is None and quote is None and not command_comment:
            remember(" ")
        # SPSS /* comments end at */ or the physical line ending. Unlike
        # COMMENT and * command comments, they never consume the following line.
        block_comment = False

    warnings = []
    for collection, label in ((changes, "Normalized"), (suspects, "Potentially unsupported")):
        if collection["count"]:
            suffix = "; further locations omitted" if collection["count"] > len(collection["samples"]) else ""
            warnings.append("{} {} syntax character{} before SPSS submission ({}{}).{}".format(
                label, collection["count"], "" if collection["count"] == 1 else "s",
                "; ".join(collection["samples"]), suffix,
                " Left unchanged; inspect the source." if collection is suspects else " Source file unchanged.",
            ))
    return "".join(normalized_lines), tab_count, changed_lines, warnings, normalized_endings


def _normalize_syntax_for_submit(syntax: str) -> tuple:
    # Keep the original helper contract for callers that only need tab counts.
    normalized, tab_count, changed_lines, unused_warnings, unused_endings = _prepare_syntax_for_submit(syntax)
    return normalized, tab_count, changed_lines


class SpssBridge(object):
    _PROFILE_CHUNK_SIZE = 2000
    _PROFILE_MAX_VARIABLES = 20
    _PROFILE_MAX_CATEGORIES = 20
    _PROFILE_MAX_EXACT_DISTINCT = 10000
    _PROFILE_MAX_VALUE_LABELS = 100

    def __init__(self, spss_module, debug=False, output_language=None):
        self.spss = spss_module
        self.debug = debug
        self.started = False
        self.last_error = None
        self.output_language = output_language

    def _diagnostic(self, message):
        if self.debug:
            sys.stderr.write("{}\n".format(message))
            sys.stderr.flush()

    def _invoke(self, function, *args, **kwargs):
        # Protect stdout because it is reserved exclusively for JSONL responses.
        with redirect_stdout(sys.stderr):
            return function(*args, **kwargs)

    def _apply_output_language(self) -> None:
        """Set native output without changing the OS locale or translating HTML."""
        if self.output_language is None:
            return  # Compatibility for callers using the pre-language protocol.
        language = self.output_language
        if language not in ("Schinese", "English"):
            raise ValueError("Unsupported SPSS output language: {}".format(language))
        try:
            setter = getattr(self.spss, "SetOutputLanguage", None)
            if callable(setter):
                self._invoke(setter, language)
            else:
                # SET OLANG is documented for external Python sessions too.
                self._invoke(self.spss.Submit, "SET OLANG={}.".format(language))
            actual = self._invoke(self.spss.GetSetting, "OLANG")
            if str(actual).strip().lower() != language.lower():
                raise RuntimeError("SPSS reported OLANG={!r} after the request.".format(actual))
        except Exception as exc:
            message = (
                "Could not set SPSS output language to {}. "
                "Verify that the corresponding SPSS language files are installed. {}"
            ).format(language, exc)
            self.last_error = message
            raise RuntimeError(message)
        self._diagnostic("SPSS output language: {}".format(language))

    def start(self, output_language=None):
        if output_language is not None:
            if output_language not in ("Schinese", "English"):
                raise ValueError("Unsupported SPSS output language: {}".format(output_language))
            self.output_language = output_language
        if self.started:
            return
        self._diagnostic("Starting IBM SPSS Statistics processor")
        self._invoke(self.spss.StartSPSS)
        self.started = True
        try:
            self._apply_output_language()
            self.last_error = None
        except Exception as exc:
            # Startup is not ready until the requested output language is usable.
            # Keep started=True if cleanup fails so EOF/shutdown retries StopSPSS.
            message = str(exc)
            try:
                self._invoke(self.spss.StopSPSS)
                self.started = False
            except Exception as cleanup_error:
                message += " SPSS startup cleanup failed: {}".format(cleanup_error)
            self.last_error = message
            raise RuntimeError(message)

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
            "active": variable_count > 0,
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

    @staticmethod
    def _normalized_value(value):
        if isinstance(value, str):
            return value.rstrip()
        return value

    def _missing_spec(self, index):
        try:
            result = self._invoke(self.spss.GetVarMissingValues, index)
            return tuple(result) if result is not None else (0, None, None, None)
        except Exception as exc:
            self._diagnostic("Missing-value metadata unavailable for variable {}: {}".format(index, exc))
            return (0, None, None, None)

    def _is_missing(self, value, missing_spec):
        if value is None:
            return True
        if isinstance(value, float) and not math.isfinite(value):
            return True
        normalized = self._normalized_value(value)
        missing_type = int(missing_spec[0] or 0)
        values = [self._normalized_value(item) for item in missing_spec[1:4]]
        if missing_type == 0:
            return any(item is not None and normalized == item for item in values)
        lower, upper, discrete = values
        in_range = lower is not None and upper is not None and lower <= normalized <= upper
        if missing_type == 1:
            return in_range
        if missing_type == 2:
            return in_range or (discrete is not None and normalized == discrete)
        return False

    @staticmethod
    def _mapping_items(value):
        if value is None:
            return []
        data = getattr(value, "data", value)
        if hasattr(data, "items"):
            return list(data.items())
        if hasattr(data, "iteritems"):
            return list(data.iteritems())
        return []

    def _value_labels(self, dataset_object, metadata):
        try:
            variable = dataset_object.varlist[metadata["name"]]
            items = self._mapping_items(getattr(variable, "valueLabels", None))
        except Exception as exc:
            self._diagnostic("Value labels unavailable for variable {}: {}".format(metadata["name"], exc))
            items = []
        items.sort(key=lambda item: str(self._normalized_value(item[0])))
        labels = [
            {
                "value": self._json_cell(self._normalized_value(value)),
                "label": str(label or "")[:500],
            }
            for value, label in items[:self._PROFILE_MAX_VALUE_LABELS]
        ]
        lookup = {
            self._normalized_value(value): str(label or "")[:500]
            for value, label in items[:self._PROFILE_MAX_VALUE_LABELS]
        }
        return labels, len(items) > self._PROFILE_MAX_VALUE_LABELS, lookup

    @staticmethod
    def _is_temporal_format(format_value):
        prefix = str(format_value or "").upper().split(".", 1)[0]
        return prefix.startswith((
            "DATE", "ADATE", "EDATE", "JDATE", "SDATE", "DATETIME",
            "TIME", "DTIME", "WKDAY", "MONTH", "MOYR", "QYR", "WKYR",
        ))

    @staticmethod
    def _temporal_value(value, format_value):
        if isinstance(value, datetime.datetime):
            return value.isoformat(sep=" ")
        if isinstance(value, (datetime.date, datetime.time)):
            return value.isoformat()
        if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            return str(value)
        prefix = str(format_value or "").upper().split(".", 1)[0]
        seconds = float(value)
        if prefix.startswith(("TIME", "DTIME")):
            sign = "-" if seconds < 0 else ""
            seconds = abs(seconds)
            hours = int(seconds // 3600)
            minutes = int((seconds % 3600) // 60)
            remaining = int(round(seconds % 60))
            return "{}{:02d}:{:02d}:{:02d}".format(sign, hours, minutes, remaining)
        try:
            converted = datetime.datetime(1582, 10, 14) + datetime.timedelta(seconds=seconds)
            return converted.isoformat(sep=" ")
        except (OverflowError, ValueError):
            return str(value)

    @staticmethod
    def _summary_kind(metadata, has_value_labels):
        level = str(metadata.get("measurementLevel", "")).strip().lower()
        if SpssBridge._is_temporal_format(metadata.get("format")):
            return "temporal"
        if metadata.get("type", "").startswith("String"):
            return "categorical"
        if level in ("nominal", "ordinal") or (not level and has_value_labels):
            return "categorical"
        return "continuous"

    def _profile_json_value(self, value):
        converted = self._json_cell(value)
        return converted[:500] if isinstance(converted, str) else converted

    @staticmethod
    def _single_column_values(values):
        for value in values:
            if isinstance(value, (list, tuple)) and len(value) == 1:
                yield value[0]
            else:
                yield value

    def _bounded_category_update(self, state, value):
        if not state["approximate"]:
            state["counts"][value] += 1
            if len(state["counts"]) <= self._PROFILE_MAX_EXACT_DISTINCT:
                return
            most_common = state["counts"].most_common(self._PROFILE_MAX_CATEGORIES)
            state["counts"] = Counter(dict(most_common))
            state["approximate"] = True
            state["distinctCountAtLeast"] = self._PROFILE_MAX_EXACT_DISTINCT + 1
            return
        counts = state["counts"]
        if value in counts:
            counts[value] += 1
            return
        if len(counts) < self._PROFILE_MAX_CATEGORIES:
            counts[value] = 1
            return
        minimum_value, minimum_count = min(counts.items(), key=lambda item: (item[1], str(item[0])))
        del counts[minimum_value]
        counts[value] = minimum_count + 1

    def _profile_variable(self, dataset_object, metadata, total_cases):
        labels, labels_truncated, label_lookup = self._value_labels(dataset_object, metadata)
        kind = self._summary_kind(metadata, bool(label_lookup))
        missing_spec = self._missing_spec(metadata["index"])
        valid_count = 0
        missing_count = 0
        categorical = {
            "counts": Counter(),
            "approximate": False,
        }
        continuous_count = 0
        continuous_mean = 0.0
        continuous_m2 = 0.0
        minimum = None
        maximum = None
        for offset in range(0, total_cases, self._PROFILE_CHUNK_SIZE):
            end = min(total_cases, offset + self._PROFILE_CHUNK_SIZE)
            values = dataset_object.cases[slice(offset, end), metadata["index"]]
            for raw_value in self._single_column_values(values):
                value = self._normalized_value(raw_value)
                if self._is_missing(value, missing_spec):
                    missing_count += 1
                    continue
                valid_count += 1
                if kind == "categorical":
                    self._bounded_category_update(categorical, value)
                elif kind == "continuous":
                    numeric = float(value)
                    continuous_count += 1
                    minimum = numeric if minimum is None else min(minimum, numeric)
                    maximum = numeric if maximum is None else max(maximum, numeric)
                    delta = numeric - continuous_mean
                    continuous_mean += delta / continuous_count
                    continuous_m2 += delta * (numeric - continuous_mean)
                else:
                    minimum = value if minimum is None or value < minimum else minimum
                    maximum = value if maximum is None or value > maximum else maximum
        if kind == "categorical":
            top_values = []
            for value, frequency in sorted(
                categorical["counts"].items(),
                key=lambda item: (-item[1], str(item[0])),
            )[:self._PROFILE_MAX_CATEGORIES]:
                entry = {
                    "value": self._profile_json_value(value),
                    "frequency": int(frequency),
                }
                label = label_lookup.get(value)
                if label:
                    entry["label"] = label
                top_values.append(entry)
            summary = {
                "kind": "categorical",
                "validN": valid_count,
                "missingN": missing_count,
                "approximate": bool(categorical["approximate"]),
                "topValues": top_values,
            }
            if categorical["approximate"]:
                summary["distinctCountAtLeast"] = categorical["distinctCountAtLeast"]
            else:
                summary["distinctCount"] = len(categorical["counts"])
        elif kind == "continuous":
            summary = {
                "kind": "continuous",
                "validN": valid_count,
                "missingN": missing_count,
            }
            if continuous_count:
                summary.update({
                    "minimum": minimum,
                    "maximum": maximum,
                    "mean": continuous_mean,
                })
                if continuous_count > 1:
                    summary["standardDeviation"] = math.sqrt(continuous_m2 / (continuous_count - 1))
        else:
            summary = {
                "kind": "temporal",
                "validN": valid_count,
                "missingN": missing_count,
            }
            if minimum is not None:
                summary["earliest"] = self._temporal_value(minimum, metadata.get("format"))
                summary["latest"] = self._temporal_value(maximum, metadata.get("format"))
        profile = dict(metadata)
        profile.update({
            "valueLabels": labels,
            "valueLabelsTruncated": labels_truncated,
            "summary": summary,
        })
        return profile

    def variable_profiles(self, variable_names):
        self.start()
        started_at = time.monotonic()
        if not isinstance(variable_names, list):
            raise ValueError("variableProfiles variableNames must be a list.")
        if not 1 <= len(variable_names) <= self._PROFILE_MAX_VARIABLES:
            raise ValueError("variableProfiles requires between 1 and 20 variables.")
        if any(not isinstance(name, str) or not name for name in variable_names):
            raise ValueError("variableProfiles names must be non-empty strings.")
        if len(set(variable_names)) != len(variable_names):
            raise ValueError("variableProfiles names must be unique.")
        info_response = self.dataset_info()
        info = info_response["datasetInfo"]
        if not info["active"]:
            raise ValueError("No Active Dataset is available.")
        by_name = {variable["name"]: variable for variable in info["variables"]}
        missing_names = [name for name in variable_names if name not in by_name]
        if missing_names:
            raise ValueError("Unknown Active Dataset variable: {}".format(missing_names[0]))
        dataset_object = None
        data_step_started = False
        original_name = info["datasetName"]
        restore_name = original_name if original_name != "*" and re.match(r"^[A-Za-z@#$][A-Za-z0-9_@#$]*$", original_name) else None
        try:
            self._invoke(self.spss.StartDataStep)
            data_step_started = True
            # Keep SPSS epoch values here so numeric user-missing ranges remain
            # comparable; temporal values are converted only after aggregation.
            dataset_object = self._invoke(self.spss.Dataset, cvtDates=False)
            total_cases = info["caseCount"]
            if total_cases < 0:
                total_cases = len(dataset_object.cases)
            profiles = [
                self._profile_variable(dataset_object, by_name[name], total_cases)
                for name in variable_names
            ]
        finally:
            if dataset_object is not None and hasattr(dataset_object, "close"):
                self._invoke(dataset_object.close)
            if data_step_started:
                self._invoke(self.spss.EndDataStep)
            if restore_name is not None:
                self._invoke(self.spss.Submit, "DATASET NAME {}.".format(restore_name))
        response_profiles = {
            "datasetName": info["datasetName"],
            "caseCount": total_cases,
            "profiles": profiles,
        }
        for key in ("weightVariable", "splitVariables", "filterVariable"):
            if key in info:
                response_profiles[key] = info[key]
        return {
            "ok": True,
            "errorLevel": 0,
            "output": "",
            "warnings": [],
            "error": None,
            "durationMs": int(round((time.monotonic() - started_at) * 1000)),
            "engineAlive": self.started,
            "variableProfiles": response_profiles,
        }

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

    def run(self, syntax, output_directory, run_id, output_language=None):
        self.start(output_language)
        # User syntax can change OLANG, so restore the display-language policy
        # before every submission, before opening this run's OMS destination.
        self._apply_output_language()
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
        submitted_syntax, unused_tabs, unused_lines, normalization_warnings, normalized_endings = _prepare_syntax_for_submit(
            syntax, cache_text_imports=True,
        )
        warnings.extend(normalization_warnings)
        if normalized_endings:
            self._diagnostic("Normalized {} physical CR/CRLF line endings before SPSS submission".format(normalized_endings))

        try:
            try:
                self._invoke(self.spss.Submit, oms_command)
                oms_active = True
            except Exception as exc:
                capture_error = "OMS capture could not start: {}".format(exc)
                warnings.append(capture_error)

            try:
                # Normalize the in-memory copy once; never retry user commands.
                # Keep virtual text imports seekable before later user commands.
                # Preserve literal payloads while making physical CRLF lines safe.
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
        summary = None
        if self.started:
            try:
                count = int(self._invoke(self.spss.GetVariableCount))
                if count > 0:
                    summary = {"variableCount": count, "caseCount": int(self._invoke(self.spss.GetCaseCount))}
            except Exception:
                # Counts are advisory; never replace this run's original result.
                pass
        response = {
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
        if summary is not None:
            response["datasetSummary"] = summary
        return response

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

    def clear_data(self) -> dict:
        """Discard only this processor's datasets; never save or erase a file."""
        if self.started:
            started_at = time.monotonic()
            # CLOSE ALL alone leaves the active data intact. NEW FILE first
            # ensures that the surviving active dataset is empty.
            self._invoke(self.spss.Submit, "NEW FILE.\nDATASET CLOSE ALL.")
            level, message = self._last_error()
            if level > 1:
                raise RuntimeError(message or "SPSS could not clear session data.")
            if int(self._invoke(self.spss.GetVariableCount)) != 0:
                raise RuntimeError("SPSS session data are still present after Clear.")
        else:
            started_at = time.monotonic()
        return {
            "ok": True, "errorLevel": 0, "output": "", "warnings": [],
            "error": None, "durationMs": int(round((time.monotonic() - started_at) * 1000)),
            "engineAlive": self.started,
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
            self.start(request.get("outputLanguage"))
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
            response = self.run(syntax, output_directory, run_id, request.get("outputLanguage"))
        elif operation == "datasetInfo":
            response = self.dataset_info()
        elif operation == "datasetPage":
            response = self.dataset_page(
                request.get("offset", 0),
                request.get("limit", 100),
                request.get("variableStart", 0),
                request.get("variableLimit", 50),
            )
        elif operation == "variableProfiles":
            response = self.variable_profiles(request.get("variableNames"))
        elif operation == "clearData":
            response = self.clear_data()
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
    _configure_utf8_stdio()
    debug = os.environ.get("SPSS_STUDIO_DEBUG") == "1"
    sys.stderr.write("SPSS_STUDIO_RUNTIME Python {} | executable {}\n".format(
        sys.version.split()[0], sys.executable,
    ))
    sys.stderr.flush()
    import_error = None
    bridge = None
    try:
        with redirect_stdout(sys.stderr):
            import spss  # pylint: disable=import-outside-toplevel
        bridge = SpssBridge(spss, debug=debug)
    except Exception as exc:
        import_error = "Unable to import IBM SPSS Python module: {}: {}".format(type(exc).__name__, exc)
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
            if debug:
                traceback.print_exc(file=sys.stderr)
            response = _failure_response(
                request_id,
                "{}: {}".format(type(exc).__name__, exc),
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
