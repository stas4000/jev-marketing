"""Bounded input parsing and workflow validation."""

import csv
import io
import json
import math
import re
from datetime import date
from pathlib import Path

MAX_BYTES = 64 * 1024 * 1024
MAX_RECORDS = 100_000
WORKFLOWS = ("ad_tags", "survival", "briefs", "search_terms", "fatigue", "landing_match", "leads")
BUSINESS_FIELDS = {"company", "industry", "company_size", "need", "budget", "timeline", "role"}
RECORD_FIELDS = {
    "ad_tags": {"id", "text", "creative_format", "start_date", "active", "end_date"},
    "survival": {"id", "format", "start_date", "active", "end_date"},
    "briefs": {"id", "hook", "body", "cta"},
    "search_terms": {"id", "query", "impressions", "clicks", "cost", "conversions"},
    "fatigue": {"id", "prior", "current"},
    "landing_match": {"id", "ad_text", "landing_text"},
    "leads": {"id", "business_facts"},
}


class ValidationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def known_fields(value, allowed, label):
    require(isinstance(value, dict), label + ": object required")
    require(set(value) <= allowed, label + ": unsupported fields; allowed: " + ", ".join(sorted(allowed)))


def number(value, label, minimum=0, maximum=None, integer=False):
    try:
        finite = type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        finite = False
    require(finite, f"{label}: finite number required")
    require(value >= minimum and (maximum is None or value <= maximum), f"{label}: out of range")
    require(not integer or type(value) is int, f"{label}: integer required")
    return value


def text(value, label, limit=16000):
    require(isinstance(value, str) and bool(value.strip()) and len(value) <= limit, f"{label}: nonempty text up to {limit} characters required")
    return value


def day(value, label):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value), f"{label}: YYYY-MM-DD required")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValidationError(f"{label}: invalid date") from exc


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_json(raw):
    try:
        return json.loads(raw, object_pairs_hook=_pairs, parse_constant=lambda s: (_ for _ in ()).throw(ValidationError("nonfinite JSON number")))
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise ValidationError("invalid JSON: " + str(exc)[:160]) from exc


def read_file(path):
    with Path(path).open("rb") as stream:
        raw = stream.read(MAX_BYTES + 1)
    require(len(raw) <= MAX_BYTES, f"input exceeds {MAX_BYTES} bytes")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeError as exc:
        raise ValidationError("input must be UTF-8") from exc


def load_input(path, workflow, context=None):
    raw = read_file(path)
    if Path(path).suffix.lower() != ".csv":
        require(context is None, "--context is only for CSV")
        return parse_json(raw)
    require(workflow == "search_terms", "CSV is supported only for search_terms")
    require(context is not None, "CSV requires --context JSON containing brand and as_of")
    data = parse_json(read_file(context))
    require(isinstance(data, dict) and "records" not in data, "CSV context must be an object without records")
    reader = csv.DictReader(io.StringIO(raw))
    fields = {"id", "query", "impressions", "clicks", "cost", "conversions"}
    require(reader.fieldnames is not None and set(reader.fieldnames) == fields and len(reader.fieldnames) == len(fields), "CSV columns must be id,query,impressions,clicks,cost,conversions")
    records = []
    try:
        for row in reader:
            require(len(records) < MAX_RECORDS and None not in row and all(v is not None for v in row.values()), "CSV row count or columns invalid")
            for key in ("impressions", "clicks"):
                row[key] = int(row[key])
            row["conversions"] = float(row["conversions"])
            row["cost"] = float(row["cost"])
            records.append(row)
    except (ValueError, csv.Error) as exc:
        raise ValidationError("invalid CSV metric or row") from exc
    return {**data, "records": records}


def observation(row, as_of, label):
    start = day(row.get("start_date"), label + ".start_date")
    require(start <= as_of, label + ": start is after as_of")
    require(type(row.get("active")) is bool, label + ": active must be boolean")
    if row["active"]:
        require(row.get("end_date") is None, label + ": active ad cannot have end_date")
        end = as_of
    else:
        end = day(row.get("end_date"), label + ".end_date")
    require(start <= end <= as_of, label + ": dates must satisfy start <= end <= as_of")
    return (end - start).days


def window(value, as_of, label):
    known_fields(value, {"start_date", "end_date", "impressions", "clicks", "reach"}, label)
    start, end = day(value.get("start_date"), label), day(value.get("end_date"), label)
    require(start <= end <= as_of, label + ": invalid date range")
    for key in ("impressions", "clicks", "reach"):
        number(value.get(key), label + "." + key, maximum=10**15, integer=True)
    require(value["clicks"] <= value["impressions"] and value["reach"] <= value["impressions"], label + ": clicks/reach exceed impressions")
    require(value["reach"] > 0 or value["impressions"] == 0, label + ": impressions require positive reach")
    return start, end


def validate(workflow, data):
    require(workflow in WORKFLOWS, "unknown workflow")
    known_fields(data, {"as_of", "brand", "icp", "records"}, "input")
    try:
        encoded_size = len(json.dumps(data, allow_nan=False).encode())
    except (ValueError, TypeError, RecursionError) as exc:
        raise ValidationError("input must contain finite JSON data") from exc
    require(encoded_size <= MAX_BYTES, "input too large")
    as_of = day(data.get("as_of"), "as_of")
    records = data.get("records")
    require(isinstance(records, list) and 1 <= len(records) <= MAX_RECORDS, f"records must contain 1..{MAX_RECORDS} rows")
    if workflow in ("briefs", "search_terms") or "brand" in data:
        brand = data.get("brand")
        known_fields(brand, {"name", "description", "keywords"}, "brand")
        for key in ("name", "description"):
            text(brand.get(key), "brand." + key)
        keywords = brand.get("keywords")
        require(isinstance(keywords, list) and 1 <= len(keywords) <= 50, "brand.keywords: 1..50 terms required")
        for value in keywords:
            text(value, "brand.keyword", 100)
    if workflow == "leads" or "icp" in data:
        icp = data.get("icp")
        known_fields(icp, BUSINESS_FIELDS - {"company", "role"}, "icp")
        require(bool(icp), "icp: at least one business criterion required")
        for key, value in icp.items():
            text(value, "icp." + key)
    ids = set()
    for row in records:
        known_fields(row, RECORD_FIELDS[workflow], "record")
        identity = text(row.get("id"), "id", 100)
        require(identity not in ids, "duplicate record id: " + identity)
        ids.add(identity)
        if workflow in ("ad_tags", "survival"):
            observation(row, as_of, identity)
            text(row.get("creative_format" if workflow == "ad_tags" else "format"), "format", 100)
        for key in {"ad_tags": ("text",), "briefs": ("hook", "body", "cta"), "search_terms": ("query",), "landing_match": ("ad_text", "landing_text")}.get(workflow, ()):
            text(row.get(key), identity + "." + key)
        if workflow == "search_terms":
            for key in ("impressions", "clicks"):
                number(row.get(key), key, maximum=10**15, integer=True)
            number(row.get("conversions"), "conversions", maximum=10**15)
            number(row.get("cost"), "cost", maximum=10**15)
            require(row["clicks"] <= row["impressions"], "clicks exceed impressions")
        if workflow == "fatigue":
            prior = window(row.get("prior"), as_of, "prior")
            current = window(row.get("current"), as_of, "current")
            require(prior[1] < current[0], "fatigue windows must be ordered and non-overlapping")
            require(prior[1] - prior[0] == current[1] - current[0], "fatigue windows must have equal duration")
        if workflow == "leads":
            facts = row.get("business_facts")
            known_fields(facts, BUSINESS_FIELDS, "business_facts")
            require(bool(facts), "business_facts: at least one business fact required")
            for key, value in facts.items():
                text(value, "business_facts." + key)
    return as_of
