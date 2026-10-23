# Usage response fixture

`oauth-usage.json` reproduces the public response reported by an endpoint user in
[Claude-Code-Usage-Monitor issue 202](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/202),
opened April 11, 2026. Only the response body is included; it has no credentials or
account identifiers. It preserves fractional-second reset timestamps and unrelated
model/extra-usage fields. Tests add synthetic obfuscated fields separately.

No local account or keychain was accessed to obtain this fixture.

# Limit error fixtures

`limit-errors.txt` contains the 24-hour example from ticket 05, the error reported
in [anthropics/claude-code issue 93974](https://github.com/anthropics/claude-code/issues/93974),
and the error quoted by the affected developer in their
[Swift Forums report](https://forums.swift.org/t/fun-project-aro-a-feature-driven-programming-language-built-with-ai/83513).
Only the limit message is retained. These fixtures require no local account access.

# Statusline fixture

`statusline-before.py` is a synthetic legacy renderer for ticket 08's
`model | cwd | git | context | sess … | wk … | email` layout. It is not a copy
of the user's original script, which is absent from the checkout. Tests feed it
arbitrary prefix segments, execute it before and after wrapping, compare the raw
prefix bytes, and confirm removal of the synthetic email. Each usage window is emitted independently when valid; either or both can be
omitted before live rate limits arrive. Git and email can also be omitted,
matching the reported legacy-script branches. It reads only stdin and
performs no filesystem, credential, or network access.

`statusline-workload.sh` / `statusline-workload.py` are the benchmark workload,
not copies of the personal script. They add a shell wrapper, stdin capture, a git
branch lookup, a 1,000-line synthetic transcript read and fixture identity lookup.
All default benchmark filesystem access stays inside its disposable tree.
