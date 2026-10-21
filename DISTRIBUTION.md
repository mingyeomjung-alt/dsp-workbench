# Public experimental evaluation

On 2026-10-17 the owner authorized making this reviewed repository public so
people can find it, try it locally, and leave feedback. The owner selected
**evaluation only: commercial use and redistribution require separate permission**.
See [LICENSE.md](LICENSE.md) for the actual project-code permission. This is
source-available evaluation software, **not an open-source licence or a
commercially validated release**. Third-party components retain their own terms.

This decision supersedes the earlier owner-private storage restriction for this
repository. The [checkpoint notes](docs/CHECKPOINT.md) retain the historical
private-save decision and frozen source archive hashes. `bundle-manifest.json`
describes the current public experimental-evaluation package, English interface,
and browser adapter `0.1.20-web.4`; the DSP engine remains `0.1.20`.

Current instructions, feedback forms, and the active interface are in English.
The immutable SDK source ZIP retains its original historical documentation and
test fixtures, including earlier-language material. It is not the active browser
interface, and translating the presentation does not rewrite that source snapshot
or the engine wheel.

## Publication boundary

### No-install demo authorization — 2026-10-21

The owner authorized a public **GitHub Pages static evaluation demo** at
[the project Pages URL](https://mingyeomjung-alt.github.io/dsp-workbench/).
The first manual deployment succeeded on 2026-10-21, and the hosted owned
example and JSON/HTML downloads were checked in a desktop browser. See
[verification scope](docs/VERIFICATION.md) for evidence and limits. The public demo is intended
to remove the clone, Node.js and local-terminal requirements for trying the
included example. The local preview remains available.

This extension does **not** authorize an audio-upload server, an analysis API,
accounts, tracking, automatic usage/result collection, package publication,
commercial permission or a support contract. The static host serves reviewed
application/runtime assets and owned synthetic examples only. Selected audio
remains in volatile browser memory. GitHub and the runtime CDN receive ordinary
asset requests under their own terms. The [evaluation licence](LICENSE.md) is
unchanged, including its restrictions on production use and redistribution.

### Reviewed repository contents

Only this reviewed repository and its reviewed Git history are published. **Never
upload its parent workspace.** Personal recordings, downloaded datasets/models,
credentials, unrelated projects and full historical evaluation stores are not
part of the public project. The three demo WAVs are owned synthetic examples.
The included engine source ZIP and wheel expose project code; they are not
encrypted or code-hidden. Public copies and GitHub forks may remain available
even if the repository later becomes private. Restricted evaluation terms are
not a technical copy-protection mechanism.

The 2026-10-17 decision did not include hosted deployment; only the static
GitHub Pages evaluation demo was added by the 2026-10-21 authorization above.
No other new hosted site, package-registry publication, paid offer, customer
invitation or support contract is included. The existing separately hosted
private site is unchanged. The local Node server
binds to 127.0.0.1, has no account/login layer, and must not be exposed as an
internet-facing application server. `package.json` keeps `private: true` to
prevent accidental npm publication; that flag does not control GitHub visibility.

The repository check workflow is separate from static Pages publication.
Passing checks or publishing a demo is not field accuracy, customer utility or whole-audio approval.
The engine, thresholds, runtime assets and current browser verification limits
are unchanged by publication.

## Feedback

Use [workflow feedback](https://github.com/mingyeomjung-alt/dsp-workbench/issues/new?template=usage_feedback.yml)
or [bug reports](https://github.com/mingyeomjung-alt/dsp-workbench/issues/new?template=bug_report.yml).
**Issues and attachments are public.** Do not submit private audio, recordings of
people, customer details, credentials, full paths, private filenames, sensitive
hashes or unreviewed exported reports. Use synthetic reproductions and sanitized
text. No analytics or automatic audio/result collection is added. GitHub itself
handles account data and ordinary repository/issue traffic under its own terms.
See [SECURITY.md](SECURITY.md) for handling sensitive security findings.
