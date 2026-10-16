# Contributing

Thanks for helping improve Synth Piano!

## Setup

```bash
npm install
npm run dev        # Electron app with hot reload
npm run check      # typecheck, lint and tests — run before pushing
```

`npm run dev:web` starts only the renderer in a browser, which is handy for UI work.
Native features (file dialogs, PDF printing) then use browser fallbacks.

## Commit messages

Releases are fully automatic, so commit messages must follow
[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(export): add pedal bracket style
fix(recording): close held notes when the loop wraps
perf(roll): draw only visible notes
docs: explain tempo detection
```

* `feat` → minor release, `fix` / `perf` / `refactor` / `revert` → patch release.
* `!` after the type or a `BREAKING CHANGE:` footer → major release.
* `docs`, `chore`, `ci`, `test`, `style`, `build` → no release.

Use `npm run release:next` to see which version and notes the next release would get.
For hand-written release notes, add a `## [x.y.z]` section to `CHANGELOG.md` before
merging. It is used instead of the generated notes.

## Pull requests

* Keep changes focused and add tests for logic in `src/core` (`tests/`).
* CI runs typecheck, lint, format check, the test suite and a Windows package build.
  The Windows installer from each run can be downloaded from the workflow's artifacts.
* For changes to the sheet music engine, look at the output, not just the tests:
  `SAMPLE_OUT=/tmp/sample npx vitest run tests/notation/sample-output.test.ts` writes
  the engraved test piece as SVG and MusicXML.

## Code signing (maintainers)

Releases are unsigned by default. To sign them, add the repository secrets
`WIN_CSC_LINK` (base64-encoded `.pfx`) and `WIN_CSC_KEY_PASSWORD`. electron-builder
picks them up in the release workflow.
