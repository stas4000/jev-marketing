import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from jev_marketing.engine import demo_answers, questions_for, run
from jev_marketing.provider import JevProvider, ProviderError, validate_answers, validate_questions
from jev_marketing.validation import ValidationError, WORKFLOWS, load_input, parse_json

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = json.loads((ROOT / "jev_marketing" / "fixtures.json").read_text())


def fixture(name):
    return copy.deepcopy(FIXTURES[name])


def valid_answers(questions):
    output = {}
    for key, question in questions.items():
        if question["type"] == "choice":
            picked = list(question["criteria"])[0]
            output[key] = {"type": "choice", "choice": picked, "confidence": .9, "probabilities": {name: float(name == picked) for name in question["criteria"]}}
        else:
            output[key] = {"type": "score", "score": 2, "confidence": .9, "legend": {str(i): label for i, label in enumerate(question["criteria"])}, "probabilities": {"0": 0, "1": 0, "2": 1}}
    return output


class WorkflowTests(unittest.TestCase):
    def test_all_examples_and_packaged_fixtures_match(self):
        for name in WORKFLOWS:
            with self.subTest(workflow=name):
                self.assertEqual(fixture(name), json.loads((ROOT / "examples" / f"{name}.json").read_text()))
                result = run(name, fixture(name))
                self.assertEqual(len(result["rows"]), len(FIXTURES[name]["records"]))
                self.assertEqual(result["usage"]["calls"], 0)
                self.assertIsNone(result["usage"]["cost"])
                self.assertEqual(result["method"], "validated_math" if name in ("survival", "fatigue") else "demo_heuristic")
                json.dumps(result, allow_nan=False)

    def test_survival_eligible_denominator_and_boundary(self):
        result = run("survival", fixture("survival"))
        groups = {g["format"]: g for g in result["summary"]}
        self.assertEqual(groups["video"], {"format": "video", "total": 3, "eligible": 2, "reached_60_days": 1, "ended_before_60_days": 1, "censored": 1, "observed_60_day_rate": .5})
        self.assertEqual(result["rows"][3]["observed_days"], 60)
        self.assertEqual(result["rows"][3]["decision"], "reached_60_days")
        data = fixture("survival")
        data["records"] = [data["records"][2]]
        self.assertIsNone(run("survival", data)["summary"][0]["observed_60_day_rate"])

    def test_fatigue_math_and_insufficient_data(self):
        result = run("fatigue", fixture("fatigue"))
        self.assertEqual([row["decision"] for row in result["rows"]], ["review", "no_signal", "insufficient_data"])
        self.assertEqual([row["suggested_action"] for row in result["rows"]], ["replace", "leave", "review"])
        self.assertEqual(result["rows"][0]["current_frequency"], 4)
        self.assertAlmostEqual(result["rows"][0]["ctr_relative_decline"], .5)
        data = fixture("fatigue")
        for window in ("prior", "current"):
            data["records"][0][window].update(impressions=0, clicks=0, reach=0)
        row = run("fatigue", data)["rows"][0]
        self.assertIsNone(row["prior_frequency"])
        self.assertIsNone(row["ctr_relative_decline"])
        data = fixture("fatigue")
        data["records"][0]["current"]["clicks"] = 0
        self.assertEqual(run("fatigue", data)["rows"][0]["suggested_action"], "replace")

    def test_fatigue_threshold_equality(self):
        data = fixture("fatigue")
        data["records"][0]["prior"].update(impressions=10000, clicks=250, reach=4000)
        data["records"][0]["current"].update(impressions=12000, clicks=240, reach=4000)
        self.assertEqual(run("fatigue", data)["rows"][0]["suggested_action"], "refresh")

    def test_demo_review_gate_and_negative_candidate_export(self):
        data = fixture("search_terms")
        result = run("search_terms", data)
        self.assertEqual(result["negative_keyword_candidates"], [])
        self.assertTrue(all(row["decision"] == "review" for row in result["rows"]))
        result = run("search_terms", data, confidence_threshold=.5)
        self.assertEqual(result["negative_keyword_candidates"], [{"id": "query-02", "query": "remote jobs salary", "requires_human_review": True}])

    def test_csv_matches_json_including_fractional_conversions(self):
        data = load_input(ROOT / "examples/search_terms.csv", "search_terms", ROOT / "examples/search_terms_context.json")
        self.assertEqual(data, FIXTURES["search_terms"])
        self.assertEqual(run("search_terms", data), run("search_terms", fixture("search_terms")))

    def test_record_count_over_old_200_limit(self):
        data = fixture("search_terms")
        data["records"] = [{**data["records"][0], "id": str(i)} for i in range(250)]
        self.assertEqual(len(run("search_terms", data)["rows"]), 250)

    def test_invalid_inputs_rejected(self):
        changes = [
            ("survival", lambda d: d["records"][0].update(start_date="2026-09-21")),
            ("survival", lambda d: d["records"][0].update(end_date="2026-08-01")),
            ("survival", lambda d: d["records"][0].update(active=False)),
            ("survival", lambda d: d["records"][0].update(start_date="2026-02-30")),
            ("survival", lambda d: d["records"][1].update(end_date="2026-06-01")),
            ("search_terms", lambda d: d["records"][0].update(clicks=-1)),
            ("search_terms", lambda d: d["records"][0].update(clicks=True)),
            ("search_terms", lambda d: d["records"][0].update(cost=float("nan"))),
            ("search_terms", lambda d: d["records"][0].update(cost=float("inf"))),
            ("search_terms", lambda d: d["records"][0].update(impressions=10**1000)),
            ("search_terms", lambda d: d["records"][0].update(clicks=2500)),
            ("fatigue", lambda d: d["records"][0]["current"].update(reach=0)),
            ("fatigue", lambda d: d["records"][0]["current"].update(start_date="2026-09-07")),
            ("fatigue", lambda d: d["records"][0]["current"].update(end_date="2026-09-15")),
            ("leads", lambda d: d["records"][0]["business_facts"].update(age="35")),
            ("leads", lambda d: d["icp"].update(gender="male")),
            ("briefs", lambda d: d["records"][0].update(hook="")),
            ("briefs", lambda d: d["records"][0].update(body="x" * 16001)),
        ]
        for name, change in changes:
            with self.subTest(workflow=name, change=change):
                data = fixture(name)
                change(data)
                with self.assertRaises(ValidationError):
                    run(name, data)
        for records in ([], [FIXTURES["briefs"]["records"][0]] * 2):
            data = fixture("briefs")
            data["records"] = records
            with self.assertRaises(ValidationError):
                run("briefs", data)
        for threshold in (-1, 1.1, float("nan"), True):
            with self.assertRaises(ValidationError):
                run("briefs", fixture("briefs"), confidence_threshold=threshold)

    def test_duplicate_keys_and_nonfinite_json(self):
        for raw in ('{"id":1,"id":2}', '{"cost":NaN}', '{"cost":Infinity}'):
            with self.assertRaises(ValidationError):
                parse_json(raw)

    def test_size_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.json"
            path.write_text('{"long":"' + 'x' * 100 + '"}')
            with patch("jev_marketing.validation.MAX_BYTES", 20):
                with self.assertRaises(ValidationError):
                    load_input(path, "briefs")
        with patch("jev_marketing.validation.MAX_RECORDS", 1):
            with self.assertRaises(ValidationError):
                run("briefs", fixture("briefs"))


class ProviderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.requests = []
        cls.responses = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                cls.requests.append((self.path, self.headers.get("Authorization"), request))
                status, transform = cls.responses.pop(0) if cls.responses else (200, lambda x: x)
                body = {"answers": valid_answers(request["questions"]), "model": "test-model", "usage": {"input_tokens": 100, "cost": .00001}}
                body = transform(body)
                self.send_response(status)
                self.send_header("x-request-id", "local-stub-receipt")
                self.end_headers()
                self.wfile.write(body if isinstance(body, bytes) else json.dumps(body).encode())
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.requests.clear()
        self.responses.clear()
        self.env = patch.dict(os.environ, {"TYPESAFE_API_KEY": "local-test-secret", "OPENROUTER_API_KEY": "local-test-secret"})
        self.env.start()
        self.transport = patch("jev_marketing.provider.http.client.HTTPSConnection", side_effect=lambda *a, **kw: http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5))
        self.transport.start()
        self.addCleanup(self.transport.stop)
        self.addCleanup(self.env.stop)

    def test_live_all_semantic_workflows_over_real_local_http(self):
        for name in ("ad_tags", "briefs", "search_terms", "landing_match", "leads"):
            with self.subTest(workflow=name):
                result = run(name, fixture(name), mode="live")
                self.assertEqual(result["method"], "jev")
                self.assertEqual(result["usage"]["calls"], len(FIXTURES[name]["records"]))
                self.assertEqual(result["usage"]["receipts"][0]["request_id"], "local-stub-receipt")
                self.assertEqual(result["usage"]["receipts"][0]["model"], "test-model")
                self.assertIsNone(result["usage"]["seconds"])
                self.assertGreater(result["usage"]["elapsed_seconds"], 0)
                if "score" in result["rows"][0]:
                    self.assertEqual(result["rows"][0]["score"], 100)
        path, auth, payload = self.requests[0]
        self.assertEqual(path, "/v1/systemone")
        self.assertEqual(auth, "Bearer local-test-secret")
        self.assertEqual(payload["model"], "jev-latest")
        self.assertEqual(set(payload), {"model", "state", "questions"})

    def test_openrouter_contract_and_unreported_cost(self):
        def change(body):
            body["usage"] = {"input_tokens": 50}
            body["id"] = "reported-id"
            return body
        self.responses.append((200, change))
        answers, meter = JevProvider("openrouter").ask({}, questions_for("briefs"))
        self.assertEqual(self.requests[0][0], "/api/alpha/decisions")
        self.assertEqual(self.requests[0][2]["model"], "~typesafe/jev-latest")
        self.assertIsNone(meter["cost"])
        self.assertEqual(meter["request_id"], "reported-id")
        self.assertEqual(answers["hook"]["score"], 2)

    def test_missing_key_and_unknown_provider_fail_before_call(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ProviderError, "TYPESAFE_API_KEY"):
                JevProvider().ask({}, questions_for("briefs"))
        with self.assertRaises(ValidationError):
            JevProvider("https://untrusted.example")
        self.assertEqual(self.requests, [])

    def test_http_failure_no_retry_and_no_body_secret(self):
        self.responses.append((429, lambda x: b"local-test-secret upstream body"))
        with self.assertRaises(ProviderError) as caught:
            JevProvider().ask({}, questions_for("briefs"))
        self.assertEqual(len(self.requests), 1)
        self.assertIn("HTTP 429", str(caught.exception))
        self.assertNotIn("local-test-secret", str(caught.exception))

    def test_partial_failure_is_explicit(self):
        self.responses.extend([(200, lambda x: x), (529, lambda x: x)])
        with self.assertRaisesRegex(ProviderError, "row 2/3 failed after 1 successful calls; no partial output"):
            run("leads", fixture("leads"), mode="live")
        self.assertEqual(len(self.requests), 2)

    def test_oversized_later_row_rejected_before_billing(self):
        data = fixture("briefs")
        data["records"][1].update(hook="h" * 15000, body="b" * 15000)
        with self.assertRaisesRegex(ValidationError, "safety bound"):
            run("briefs", data, mode="live")
        self.assertEqual(self.requests, [])

    def test_unknown_input_fields_rejected_before_any_provider_call(self):
        secret = "not-for-provider-or-error-output"
        mutations = []
        for name in WORKFLOWS:
            mutations.extend([
                (name, lambda d: d.update(private_notes=secret)),
                (name, lambda d: d["records"][-1].update(api_key=secret)),
                (name, lambda d: d.update(brand={**FIXTURES["briefs"]["brand"], "private_notes": secret})),
                (name, lambda d: d.update(icp={"industry": "services", "private_notes": secret})),
            ])
        for name in ("prior", "current"):
            mutations.append(("fatigue", lambda d, name=name: d["records"][-1][name].update(private_notes=secret)))
        mutations.append(("leads", lambda d: d["records"][-1]["business_facts"].update(private_notes=secret)))
        with patch("jev_marketing.engine.JevProvider.ask") as provider_spy:
            for name, mutate in mutations:
                with self.subTest(workflow=name, mutation=mutate):
                    data = fixture(name)
                    mutate(data)
                    with self.assertRaisesRegex(ValidationError, "unsupported fields; allowed:") as caught:
                        run(name, data, mode="live")
                    self.assertNotIn(secret, str(caught.exception))
            provider_spy.assert_not_called()
        self.assertEqual(self.requests, [])

    def test_optional_context_and_end_date_preserved(self):
        data = fixture("ad_tags")
        data["brand"] = fixture("briefs")["brand"]
        data["icp"] = fixture("leads")["icp"]
        data["records"][0]["end_date"] = None
        self.assertEqual(len(run("ad_tags", data)["rows"]), 3)

    def test_low_provider_confidence_routes_review(self):
        def change(body):
            for answer in body["answers"].values():
                answer["confidence"] = .2
            return body
        self.responses.extend([(200, change)] * 2)
        result = run("briefs", fixture("briefs"), mode="live")
        self.assertTrue(all(row["decision"] == "review" and row["score"] == 100 for row in result["rows"]))

    def test_malformed_provider_answers_fail_closed(self):
        mutations = [
            lambda b: b.update(answers={}),
            lambda b: b["answers"]["hook"].update(type="choice"),
            lambda b: b["answers"]["hook"].update(score=True),
            lambda b: b["answers"]["hook"].update(score=2.1),
            lambda b: b["answers"]["hook"].update(score=float("nan")),
            lambda b: b["answers"]["hook"].update(confidence=".9"),
            lambda b: b["answers"]["hook"].update(confidence=-.1),
            lambda b: b["answers"]["hook"].update(probabilities={"0": 0, "1": 0}),
            lambda b: b["answers"]["hook"].update(probabilities={"0": 0, "1": 0, "2": .1}),
            lambda b: b["answers"]["hook"].update(legend={}),
            lambda b: b.update(usage={"cost": -1}),
        ]
        for mutate in mutations:
            def change(body):
                mutate(body)
                return body
            self.responses.append((200, change))
            with self.assertRaises(ProviderError):
                JevProvider().ask({}, questions_for("briefs"))
        self.responses.append((200, lambda b: b"not json"))
        with self.assertRaises(ProviderError):
            JevProvider().ask({}, questions_for("briefs"))
        self.responses.append((200, lambda b: {**b, "answers": {"relevance": {"type": "choice", "choice": "drop", "confidence": .9, "probabilities": {"keep": 1, "review": 0, "negative_candidate": 0}}}}))
        with self.assertRaises(ProviderError):
            JevProvider().ask({}, questions_for("search_terms"))

    def test_invalid_questions_never_sent(self):
        for question in ({"type": "noul", "instructions": "x", "criteria": []}, {"type": "score", "instructions": "x", "criteria": ["one"]}):
            with self.assertRaises(ValidationError):
                JevProvider().ask({}, {"a": question})
        self.assertEqual(self.requests, [])


class CLITests(unittest.TestCase):
    def cli(self, *args, input=None):
        return subprocess.run([sys.executable, "-m", "jev_marketing", *args], cwd=ROOT, input=input, text=True, capture_output=True, timeout=30)

    def test_cli_all_workflows_and_demo(self):
        listed = self.cli("list")
        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertEqual(json.loads(listed.stdout)["workflows"], list(WORKFLOWS))
        for name in WORKFLOWS:
            result = self.cli("run", name, "--input", str(ROOT / "examples" / f"{name}.json"), "--mode", "demo")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), run(name, fixture(name)))
        demo = self.cli("demo")
        self.assertEqual(demo.returncode, 0, demo.stderr)
        self.assertEqual(set(json.loads(demo.stdout)["workflows"]), set(WORKFLOWS))

    def test_cli_errors_preserve_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "bad.json"
            source.write_text('{"records": []}')
            target = Path(directory) / "out.json"
            target.write_text("previous result")
            result = self.cli("run", "briefs", "--input", str(source), "--output", str(target))
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, "")
            self.assertNotIn("Traceback", result.stderr)
            self.assertEqual(target.read_text(), "previous result")
            result = self.cli("demo", "--output", str(target))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(json.loads(target.read_text())["synthetic"])

    def test_stdio_mcp_real_subprocess(self):
        messages = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        ]
        for index, name in enumerate(WORKFLOWS, 3):
            messages.append({"jsonrpc": "2.0", "id": index, "method": "tools/call", "params": {"name": name, "arguments": {"input": fixture(name)}}})
        messages.append({"jsonrpc": "2.0", "id": 20, "method": "tools/call", "params": {"name": "briefs", "arguments": {"input": {}}}})
        response = self.cli("mcp", input="\n".join(json.dumps(message) for message in messages) + "\n")
        self.assertEqual(response.returncode, 0, response.stderr)
        results = [json.loads(line) for line in response.stdout.splitlines()]
        self.assertEqual(len(results), len(messages) - 1)
        self.assertEqual(results[0]["result"]["protocolVersion"], "2024-11-05")
        self.assertEqual(len(results[1]["result"]["tools"]), 7)
        for index, name in enumerate(WORKFLOWS, 2):
            self.assertFalse(results[index]["result"]["isError"])
            actual = json.loads(results[index]["result"]["content"][0]["text"])
            self.assertEqual(actual, run(name, fixture(name)))
        self.assertTrue(results[-1]["result"]["isError"])
        invalid = {"jsonrpc": "2.0", "id": 21, "method": "tools/call", "params": {"name": "briefs", "arguments": {"input": fixture("briefs"), "provider": []}}}
        response = self.cli("mcp", input=json.dumps(invalid) + "\n")
        self.assertEqual(response.returncode, 0, response.stderr)
        self.assertTrue(json.loads(response.stdout)["result"]["isError"])

    def test_mcp_protocol_errors_do_not_crash(self):
        response = self.cli("mcp", input='invalid\n{"jsonrpc":"2.0","id":1,"method":"unknown"}\n')
        self.assertEqual(response.returncode, 0)
        results = [json.loads(line) for line in response.stdout.splitlines()]
        self.assertEqual([r["error"]["code"] for r in results], [-32700, -32601])


if __name__ == "__main__":
    unittest.main()
