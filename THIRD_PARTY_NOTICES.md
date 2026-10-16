# Runtime components and example assets

The proprietary DSP wheel is unchanged version 0.1.20. Its SHA-256 is
`3f6dd9a01b68591bf2dd6a9851091b0e124661a2d509739a3f68d679eceab5d7`.
It contains project Python code, not NumPy/SciPy binaries or speech model weights.

The browser loads Pyodide 0.29.3 and its scientific packages from the pinned
`https://cdn.jsdelivr.net/pyodide/v0.29.3/full/` distribution. The verified runtime
uses Python 3.13.2, NumPy 2.2.5 and SciPy 1.14.1. Pyodide and its constituent
packages have separate licenses and included notices (including BLAS/LAPACK and
other bundled dependencies). Downloaded packages are not included in this folder.

References for reviewing original notices before external distribution:

- [Pyodide 0.29.3 license](https://github.com/pyodide/pyodide/blob/0.29.3/LICENSE)
- [CPython 3.13 license](https://github.com/python/cpython/blob/3.13/LICENSE)
- [NumPy 2.2.5 license](https://github.com/numpy/numpy/blob/v2.2.5/LICENSE.txt)
- [SciPy 1.14.1 license](https://github.com/scipy/scipy/blob/v1.14.1/LICENSE.txt)
- [Pyodide documentation](https://pyodide.org/en/0.29.3/usage/quickstart.html)

Version references are not an assertion that every component's distribution terms
have been legally approved. Vendoring or mirroring these binaries later requires
reviewing the actual distribution's complete notice set, not just these links.

The three WAV files in `web/demo/` are deterministic project-owned synthetic test
signals, not recordings of customers, volunteers or public speech datasets. The
screenshot in `assets/` shows that synthetic example. No external audio, fonts,
tracking libraries, machine-learning weights or image assets are shipped here.
