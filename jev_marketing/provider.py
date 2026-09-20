"""Typed Jev transport: fixed destinations, bounded responses, no retries."""

import http.client
import json
import os
import time
from urllib.parse import urlsplit

from .validation import ValidationError, number, parse_json, require, text

PROVIDERS = {
    "typesafe": ("https://api.typesafe.ai/v1/systemone", "jev-latest", "TYPESAFE_API_KEY"),
    "openrouter": ("https://openrouter.ai/api/alpha/decisions", "~typesafe/jev-latest", "OPENROUTER_API_KEY"),
}
MAX_RESPONSE = 1_000_000


class ProviderError(RuntimeError):
    pass


def validate_questions(questions):
    require(isinstance(questions, dict) and 1 <= len(questions) <= 20, "1..20 questions required")
    for key, q in questions.items():
        text(key, "question id", 100)
        require(isinstance(q, dict) and set(q) == {"type", "instructions", "criteria"}, "invalid question fields")
        text(q["instructions"], "instructions")
        criteria = q["criteria"]
        if q["type"] == "choice":
            require(isinstance(criteria, dict) and 2 <= len(criteria) <= 10, "choice needs 2..10 criteria")
            for name, value in criteria.items():
                text(name, "choice name", 100)
                text(value, "choice criterion", 1000)
        elif q["type"] == "score":
            require(isinstance(criteria, list) and 2 <= len(criteria) <= 10, "score needs 2..10 ordered criteria")
            for value in criteria:
                text(value, "score criterion", 1000)
        else:
            raise ValidationError("unsupported question type")


def validate_answers(answers, questions):
    require(isinstance(answers, dict) and set(answers) == set(questions), "response question IDs differ from request")
    for key, question in questions.items():
        answer = answers[key]
        require(isinstance(answer, dict) and answer.get("type") == question["type"], "response answer type mismatch")
        number(answer.get("confidence"), "answer confidence", maximum=1)
        allowed = set(question["criteria"]) if question["type"] == "choice" else {str(i) for i in range(len(question["criteria"]))}
        probabilities = answer.get("probabilities")
        require(isinstance(probabilities, dict) and set(probabilities) == allowed, "response probabilities mismatch")
        for value in probabilities.values():
            number(value, "probability", maximum=1)
        require(abs(sum(probabilities.values()) - 1) <= .001, "probabilities must sum to one")
        if question["type"] == "choice":
            require(answer.get("choice") in allowed, "unknown answer choice")
        else:
            number(answer.get("score"), "answer score", maximum=len(allowed) - 1)
            legend = answer.get("legend")
            require(legend == {str(i): label for i, label in enumerate(question["criteria"])}, "score legend mismatch")
    return answers


def validate_request(state, questions, model="~typesafe/jev-latest"):
    validate_questions(questions)
    payload = json.dumps({"model": model, "state": state, "questions": questions}, allow_nan=False).encode()
    # Conservative byte caps stay below the provider's documented token limits.
    require(len(payload) <= 60000, "provider request exceeds 60000-byte safety bound")
    state_size = len(json.dumps(state).encode())
    require(state_size + max(len(json.dumps(q).encode()) for q in questions.values()) <= 30000, "state plus question exceeds 30000-byte safety bound")
    return payload


class JevProvider:
    def __init__(self, provider="typesafe"):
        require(isinstance(provider, str) and provider in PROVIDERS, "unknown provider")
        self.provider = provider

    def ask(self, state, questions):
        validate_questions(questions)
        url, model, key_env = PROVIDERS[self.provider]
        key = os.environ.get(key_env)
        if not key:
            raise ProviderError("set " + key_env + " for live mode")
        payload = validate_request(state, questions, model)
        target = urlsplit(url)
        connection = http.client.HTTPSConnection(target.hostname, target.port, timeout=30)
        started = time.perf_counter()
        try:
            connection.request("POST", target.path, body=payload, headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
            response = connection.getresponse()
            if response.status != 200:
                raise ProviderError(f"{self.provider} HTTP {response.status}; not retried")
            raw = response.read(MAX_RESPONSE + 1)
            require(len(raw) <= MAX_RESPONSE, "provider response too large")
            result = parse_json(raw)
            require(isinstance(result, dict), "provider response must be an object")
            answers = validate_answers(result.get("answers"), questions)
            usage = result.get("usage", {})
            require(isinstance(usage, dict), "provider usage must be an object")
            meter = {"provider": self.provider, "calls": 1, "elapsed_seconds": time.perf_counter() - started, "input_tokens": None, "output_tokens": None, "cost": None, "seconds": None, "model": result.get("model"), "request_id": result.get("request_id") or result.get("id") or response.getheader("x-request-id")}
            for name in ("input_tokens", "output_tokens", "cost", "seconds"):
                if usage.get(name) is not None:
                    meter[name] = number(usage[name], "usage." + name, integer=name.endswith("tokens"))
            for name in ("model", "request_id"):
                if meter[name] is not None:
                    text(meter[name], name, 300)
            return answers, meter
        except (OSError, http.client.HTTPException) as exc:
            raise ProviderError(f"{self.provider} transport failed ({type(exc).__name__}); not retried") from exc
        except (ValidationError, ValueError, TypeError) as exc:
            raise ProviderError("invalid provider response: " + str(exc)[:180]) from exc
        finally:
            connection.close()
