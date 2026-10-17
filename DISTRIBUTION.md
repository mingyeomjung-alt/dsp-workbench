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
describes the earlier runtime-payload preparation, not current visibility.

## Publication boundary

Only this reviewed repository and its reviewed Git history are published. **Never
upload its parent workspace.** Personal recordings, downloaded datasets/models,
credentials, unrelated projects and full historical evaluation stores are not
part of the public project. The three demo WAVs are owned synthetic examples.
The included engine source ZIP and wheel expose project code; they are not
encrypted or code-hidden. Public copies and GitHub forks may remain available
even if the repository later becomes private. Restricted evaluation terms are
not a technical copy-protection mechanism.

No GitHub Pages deployment, new hosted site, package-registry publication, paid
offer, customer invitation or support contract is part of this decision. The
existing separately hosted private site is unchanged. The local Node server
binds to 127.0.0.1, has no account/login layer, and must not be exposed as an
internet-facing application server. `package.json` keeps `private: true` to
prevent accidental npm publication; that flag does not control GitHub visibility.

The supplied Actions workflow remains manual-only, read-only and synthetic.
Passing checks are not field accuracy, customer utility or whole-audio approval.
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
