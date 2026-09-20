"""Small MCP stdio adapter; the same validation and engine power every tool."""

import json
import sys

from .engine import LIMITS, run
from .provider import JevProvider, ProviderError
from .validation import MAX_BYTES, WORKFLOWS, ValidationError, parse_json, require

PROTOCOL = "2024-11-05"


def dispatch(request):
    require(isinstance(request, dict) and request.get("jsonrpc") == "2.0", "invalid JSON-RPC request")
    identity = request.get("id")
    method = request.get("method")
    require(isinstance(method, str), "method must be a string")
    if "id" not in request:
        return None
    require(type(identity) in (str, int) or identity is None, "invalid request id")
    params = request.get("params", {})
    require(isinstance(params, dict), "params must be an object")
    if method == "initialize":
        result = {"protocolVersion": PROTOCOL, "capabilities": {"tools": {}}, "serverInfo": {"name": "jev-marketing", "version": "0.1.0"}}
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": [{"name": name, "description": LIMITS[name] + " Default demo mode uses synthetic heuristic decisions, never Jev.", "inputSchema": {"type": "object", "properties": {"input": {"type": "object", "description": "Workflow data: as_of, records and applicable brand/icp context; see examples."}, "mode": {"type": "string", "enum": ["demo", "live"], "default": "demo"}, "provider": {"type": "string", "enum": ["typesafe", "openrouter"], "default": "typesafe"}, "confidence_threshold": {"type": "number", "minimum": 0, "maximum": 1, "default": .7}}, "required": ["input"], "additionalProperties": False}} for name in WORKFLOWS]}
    elif method == "tools/call":
        try:
            require(params.get("name") in WORKFLOWS, "unknown workflow tool")
            arguments = params.get("arguments", {})
            require(isinstance(arguments, dict) and set(arguments) <= {"input", "mode", "provider", "confidence_threshold"}, "invalid tool arguments")
            output = run(params["name"], arguments.get("input"), mode=arguments.get("mode", "demo"), confidence_threshold=arguments.get("confidence_threshold", .7), provider=JevProvider(arguments.get("provider", "typesafe")))
            result = {"content": [{"type": "text", "text": json.dumps(output, ensure_ascii=False, allow_nan=False)}], "isError": False}
        except (ValidationError, ProviderError) as exc:
            result = {"content": [{"type": "text", "text": str(exc)}], "isError": True}
    else:
        return {"jsonrpc": "2.0", "id": identity, "error": {"code": -32601, "message": "Method not found"}}
    return {"jsonrpc": "2.0", "id": identity, "result": result}


def serve():
    while True:
        line = sys.stdin.buffer.readline(MAX_BYTES + 1)
        if not line:
            return 0
        request = None
        try:
            require(len(line) <= MAX_BYTES, "MCP request too large")
            request = parse_json(line)
            response = dispatch(request)
        except ValidationError as exc:
            if isinstance(request, dict) and "id" not in request:
                continue
            identity = request.get("id") if isinstance(request, dict) else None
            if type(identity) not in (str, int):
                identity = None
            response = {"jsonrpc": "2.0", "id": identity, "error": {"code": -32600 if request is not None else -32700, "message": str(exc)}}
        if response is not None:
            print(json.dumps(response, ensure_ascii=False, allow_nan=False), flush=True)
        if len(line) > MAX_BYTES:
            return 2
