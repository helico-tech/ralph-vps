# Fix — {{id}}

A code review found issues that need to be addressed. Fix them and nothing else.

## Review Feedback

{{description}}

## Workflow

1. **Read the feedback carefully.** Each issue above includes what's wrong and what should be done. Do not reinterpret or second-guess the review — implement exactly what's asked.
2. **Fix each issue.** Make targeted changes. Do not refactor surrounding code, add features, or "improve" things that weren't flagged.
3. **Verify.** Run the full test suite after every fix. All tests must pass.
4. **Review your diff.** Confirm you addressed every issue in the feedback and didn't introduce new problems.
5. **Commit.** Stage only the files you changed (never `git add -A` or `git add .`). Commit with message: `ralph({{id}}): fix review feedback`.
