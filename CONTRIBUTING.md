# Contributing

Keep each change focused on a concrete marketing decision. Reuse the existing workflow, validation, and provider paths before adding an abstraction or dependency.

1. Fork and clone the repository. Use Python 3.11 or newer.
2. Create a virtual environment and install with `python -m pip install -e .`.
3. Add a synthetic fixture and a focused regression check for a behavior change. Mock every external API. Never commit credentials, personal lead data, customer exports, or private account information.
4. Run `python -m unittest discover -s tests -v` and `python -m jev_marketing demo`.
5. If demo behavior changes, regenerate the browser evidence with `python -m jev_marketing demo --output docs/data.json`. Do not hand-author results.
6. For presentation changes, serve `docs/` locally, inspect desktop and mobile, and exercise all seven workflow controls, JSON views, download, and clipboard fallback.
7. Open a pull request explaining the concrete behavior change and the checks you ran.

Keep uncertainty visible. Demo confidence is illustrative; model confidence is not calibrated business accuracy. Never turn a negative candidate into an account mutation or present longevity as profitability. Changes to live providers must follow current official documentation and include mocked error and response-validation checks. Do not add silent retries.

Report a security issue privately through GitHub's security reporting facilities if enabled. Otherwise contact the maintainer without disclosing secrets in a public issue.

Contributions are licensed under the repository's MIT license.
