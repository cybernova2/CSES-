# Local Run: feasibility study (browser-only)

Date: 2026-11-24. Everything marked **Tested** was run in Chrome for Testing 158 inside a Manifest V3 extension
(`poc/runtimes/ext-dist`, CSP `script-src 'self' 'wasm-unsafe-eval'`), using only files packaged in the extension.
Language versions are from <https://cses.fi/howto/> (also in `tests/fixtures/howto.html`).

Local Run is for testing with sample or custom input. It does not reproduce CSES's machine, compiler, time
limits, memory limits or verdicts. Submit stays CSES's own workflow.

## Summary

| Language | CSES version / flags | Browser runtime | Status | Known limitations | Package size (compressed / unpacked) | Complexity | Backend-free |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C++ | g++ 13.3.0, `-std=c++11/17/20/23 -O2 -Wall` | Clang/LLD 22 (`@yowasp/clang`) → wasm32-wasip1, libc++ | **Tested: works with limits** | Clang + libc++, not GCC + libstdc++ (see C/C++ details); exceptions unavailable; `long` is 32-bit; recursion ≈ 10,000–15,000 levels; no pb_ds; first run per C++ standard ≈ 20–30 s | 25.7 MB / 99.6 MB (shared with C) | High | Yes |
| C | gcc 13.3.0, `-std=c99 -O2 -Wall` | same Clang toolchain | **Tested: works** | Clang not GCC; `long` 32-bit; recursion limit as above | (included above) | Low (shares C++) | Yes |
| Python 3 | CPython 3.12.3 / PyPy 3.9.18 | Pyodide 0.27.7 (CPython **3.12.7**) | **Tested: works** | CPython only (no PyPy speed); ~2.5–3.5 s first load; no threads/subprocess | 5.6 MB / 13.2 MB | Medium | Yes |
| Ruby | ruby 3.2.3 | ruby.wasm `@ruby/3.2-wasm-wasi` 2.10.1 (CRuby 3.2) + stdlib | **Tested: works** | ~0.2–0.5 s VM start per run; slower than native (1e6-iteration loop ≈ 0.9 s) | 9.7 MB / 30.8 MB | Medium | Yes |
| Node.js | Node.js 18.19.1 | QuickJS (quickjs-emscripten 0.32.0) + CSES+ Node shim | **Tested: works for stdin/stdout programs** | Not V8/Node: only `fs.readFileSync(0)`, `readline`, `process.stdin/stdout`, `console`; other Node modules unavailable; ~10× slower than V8 | 0.3 MB / 0.9 MB | Medium | Yes |
| Python 2 | CPython 2.7.18 / PyPy 2.7.18 | none found | **Not supported** | No maintained CPython 2.7 WebAssembly build | – | – | No runtime available |
| Java | Java 11.0.30 | GraalVM `javac` on Wasm (demo) + a JVM | **Not supported (researched, not tested)** | GraalVM demo only produces `.class` files; no open-source in-browser JVM found for running them; CheerpJ is closed-source and loads from its CDN (remote code) | unknown | Very high | Not currently |
| Scala | Scala 2.11.12 | none found | **Not supported** | Scastie compiles on a server; no in-browser Scala 2 compiler found | – | – | No runtime available |
| Rust | rustc 1.75.0, editions 2018/2021, `-C opt-level=3`, crate `rand 0.8.4` | none found | **Not supported** | No maintained rustc that runs in the browser; playgrounds compile on servers | – | – | No runtime available |
| Haskell | GHC 9.2.8, `-O2 -Wall` | GHC-in-browser (experimental, 2025) | **Not supported (researched, not tested)** | Interprets bytecode only, ~50 MB rootfs download plus GHC; experimental; version differs from 9.2.8 | ≥ 50 MB (reported) | Very high | Experimental only |
| Pascal | FPC 3.2.2, `-O2` | FPC self-hosted on Wasm (reported) | **Not supported (researched, not tested)** | No ready-made wasm32 FPC binary found; would need building FPC + linker for Wasm | unknown | Very high | Unproven |
| Assembly | NASM 2.16.01 (x86-64 Linux) | Blink x86-64 emulator on Wasm (`robalb/x86-64-playground`, ISC) | **Not supported (researched, not tested)** | Promising: NASM + Linux syscalls emulated client-side; needs packaging and testing | unknown | High | Likely |
| Make | Make 4.3 | none | **Not supported** | Needs make, a shell and a compiler toolchain together | – | – | No |

Chrome Web Store allows packages up to 2 GB; WebAssembly shipped inside the package is not "remotely hosted code".
All four working runtimes together: **≈ 41 MB compressed / ≈ 145 MB unpacked**.

## Measured results (Chrome, extension page, module Web Worker per language)

| Test | Result |
| --- | --- |
| CSES A + B examples (C, C++, Python 3, Ruby, Node.js) | All pass |
| C++ runtime start (Clang loaded, warm) | 0.6–1.0 s |
| C++ compile, `#include <iostream>` | ≈ 3.9–4.4 s |
| C++ compile, `bits/stdc++.h`, no precompiled header | ≈ 3.9 s |
| C++ first run per standard: build precompiled `bits/stdc++.h` | ≈ 19–30 s (16–30 MB per standard; can be cached in IndexedDB) |
| C++ compile with cached precompiled header | ≈ 0.8–1.1 s (≈ 2.4 s for programs with large static containers) |
| C compile (A + B) | ≈ 0.1 s |
| C++ sort 1e6 + sieve 1e7 | run 0.28 s |
| Python start (Pyodide) | 2.4–3.5 s; A + B run 4 ms |
| Python 1e6-iteration loop | 0.32 s |
| Python bulk `sys.stdin.buffer.read()` of 2e5 numbers | 0.07 s |
| Python recursion with `setrecursionlimit` | 100,000 levels OK |
| Ruby VM start per run | 0.2–0.5 s; 1e6-iteration loop 0.9 s |
| Node.js (QuickJS) start | 0.03 s; 1e7-iteration loop 1.1 s |
| Infinite loop | Stopped at the time limit by terminating the worker; next run gets a fresh worker (C++ 0.5 s, Python 1.8 s restart) |
| Chrome memory after first use | JS +18 MB, Python +84 MB, Ruby +102 MB, C++ +238 MB |
| Isolation | Python/JS user code cannot make network requests (CSP `connect-src 'self'`), no `chrome.*` APIs in workers, QuickJS has no `fetch`/`XMLHttpRequest` at all; C/C++/Ruby Wasm has no network imports |

## C/C++ details

CSES uses GCC 13 with libstdc++. The browser toolchain is Clang 22 with LLVM's libc++, targeting 32-bit WebAssembly.
CSES+ must say this plainly next to Run.

| Item | Status |
| --- | --- |
| `#include <bits/stdc++.h>` | Supplied by CSES+: includes every header GCC 13's version includes that libc++ provides, with the same C++-version guards (`poc/runtimes/shim/bits/stdc++.h`). 101/107 GCC headers compile |
| Headers not available | `<csetjmp>` (needs Wasm exceptions), `<stacktrace>`, `<spanstream>`, `<stdfloat>` (not in libc++). `<generator>` is not in GCC 13 either |
| `std::__gcd`, `std::__lg` (libstdc++ internals) | Provided by a small compatibility header, force-included |
| `__int128`, `__builtin_popcount*`, `#pragma GCC optimize/target` | Work (pragmas are ignored) |
| C++11 / 17 / 20 / 23 | All compile; C++23 `std::print` works |
| Exceptions (`try`/`throw`) | **Not available**: the bundled libc++ is built without them. Programs using them get a compile error |
| `long` | **32-bit** (CSES x86-64: 64-bit). `long long` is 64-bit as on CSES. Code that relies on 64-bit `long` can overflow locally |
| pb_ds (`<ext/pb_ds/...>`, ordered_set) | **Not available** (GNU-only) |
| Deep recursion | **Limited**: a realistic DFS overflows the browser's stack at ≈ 5,000–8,000 levels, ≈ 10,000–15,000 using JSPI (secondary stack). CSES problems often need 200,000. Run must detect "Maximum call stack size exceeded" and explain it |
| Large static arrays of objects (e.g. `vector<int> g[1000005]`) | Compile slowly in Clang (≈ 10 s) |
| Optimisation | `-O2` like CSES, but different compiler and CPU; local times are not CSES times |

## Proposed architecture

- One adapter per language behind a common interface: `init()`, `run({ code, stdin, options, timeLimit }) → { phase: compile|run, ok, exit, stdout, stderr, compileMs, runMs }`.
- Each adapter runs in a dedicated module Web Worker, hosted by an extension page; the worker is terminated on timeout and recreated.
- Defence in depth (a worker alone is not a sandbox): extension CSP `connect-src 'self'`, no extension APIs in workers, runtimes without network imports, memory limits where the runtime supports them (QuickJS), output size caps, and the Run UI labelled "Local run — not CSES judging".
- A sandboxed extension page (opaque origin) hosting the workers is the next isolation step to evaluate during integration.
- Runtimes are packaged with the extension; precompiled headers are generated locally on first use and cached.

## Reproduce

```sh
cd poc/runtimes
npm install
node build-ext.mjs          # builds ext-dist/ and prints sizes
CHROME_PATH=... node poc-browser.mjs   # all browser tests
CHROME_PATH=... node poc-stack.mjs     # recursion-depth probe
CHROME_PATH=... node poc-mem.mjs       # compressed sizes + memory
node test-headers.mjs       # which GCC bits/stdc++.h headers compile
```

Sources: [CSES languages](https://cses.fi/howto/), [@yowasp/clang](https://yowasp.org/), [Pyodide](https://pyodide.org/), [ruby.wasm](https://github.com/ruby/ruby.wasm), [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten),
[GraalVM javac on Wasm](https://graalvm.github.io/graalvm-demos/web-image/javac), [Scastie](https://github.com/scalacenter/scastie),
[GHC in the browser](https://discourse.haskell.org/t/ghc-now-runs-in-your-browser/13169), [x86-64 playground (Blink)](https://github.com/robalb/x86-64-playground),
[Chrome Web Store publishing limits](https://developer.chrome.com/docs/webstore/publish), [Remotely hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code).
