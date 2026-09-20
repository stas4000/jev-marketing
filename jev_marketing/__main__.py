"""Command line entry point. Outputs are written only after a complete run."""

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

from .engine import run
from .provider import JevProvider, ProviderError
from .validation import WORKFLOWS, ValidationError, load_input, parse_json


def write_output(value, destination=None):
    rendered = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if destination is None:
        sys.stdout.write(rendered)
        return
    path = Path(destination)
    # Replace only after a complete serialization and durable write.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".jev-", delete=False) as stream:
            temporary = stream.name
            stream.write(rendered)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and os.path.exists(temporary):
            os.unlink(temporary)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Seven Jev marketing workflows. Imported data only, no account writes.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="list workflow names")
    demo = commands.add_parser("demo", help="run all bundled synthetic examples, without Jev or network")
    demo.add_argument("--output")
    commands.add_parser("mcp", help="serve seven tools over newline-delimited MCP stdio")
    execute = commands.add_parser("run", help="run one workflow")
    execute.add_argument("workflow", choices=WORKFLOWS)
    execute.add_argument("--input", required=True)
    execute.add_argument("--context", help="brand/as_of JSON metadata for search_terms CSV")
    execute.add_argument("--mode", choices=("demo", "live"), default="demo")
    execute.add_argument("--provider", choices=("typesafe", "openrouter"), default="typesafe")
    execute.add_argument("--confidence-threshold", type=float, default=.7)
    execute.add_argument("--output")
    args = parser.parse_args(argv)
    try:
        if args.command == "mcp":
            from .mcp import serve
            return serve()
        if args.command == "list":
            write_output({"workflows": list(WORKFLOWS)})
        elif args.command == "demo":
            from importlib.resources import files
            fixtures = parse_json(files("jev_marketing").joinpath("fixtures.json").read_text(encoding="utf-8"))
            write_output({"synthetic": True, "workflows": {name: {"input": fixtures[name], "output": run(name, fixtures[name])} for name in WORKFLOWS}}, args.output)
        else:
            data = load_input(args.input, args.workflow, args.context)
            output = run(args.workflow, data, mode=args.mode, confidence_threshold=args.confidence_threshold, provider=JevProvider(args.provider))
            write_output(output, args.output)
        return 0
    except (ValidationError, ProviderError, OSError) as exc:
        print("error: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
