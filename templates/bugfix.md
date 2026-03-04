# Bugfix — {{id}}

{{description}}

## Workflow

1. **Understand the bug.** Read the description above and the relevant source files. Identify the root cause before writing any code — do not guess.
2. **Write a failing test.** Create a test that reproduces the bug. Run the suite to confirm it fails as expected.
3. **Fix the root cause.** Make the minimal change necessary. Fix the underlying problem, not the symptom. Avoid touching unrelated code.
4. **Verify.** Run the full test suite. Your new test should pass. No existing tests should break.
5. **Review your diff.** Ensure you haven't introduced new problems. The diff should be minimal and focused.
6. **Commit.** Stage only the files you changed (never `git add -A` or `git add .`). Commit with message: `ralph({{id}}): fix <brief description>`.
