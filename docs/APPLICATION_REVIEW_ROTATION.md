# Application Review Rotation

The application-wide review is **coordinated** through a repository-owned
GitHub Actions workflow scheduled every 15 minutes. The workflow creates and
advances review issues; it does not run an AI reviewer or assert that the issue's
checklist has been completed. The queue is defined in
`.github/application-review-rotation.json`; each entry represents one focused
review area remaining in the active pass. The canonical feature inventory and
completion record remains `docs/app-review/PROGRESS.md`.

## How advancement works

1. `.github/workflows/application-review-rotation.yml` runs every 15 minutes
   and can also be started with **Run workflow**. Pull requests that change the
   coordinator run validation and unit tests, but never create issues. Manual
   runs create issues only when launched against the repository's default
   branch; selecting a feature branch is validation-only.
2. The workflow looks for issues carrying the `application-review-rotation`
   label and its private feature marker.
3. If a rotation issue is open, the workflow does nothing. This prevents a
   timebox from silently skipping unfinished work.
4. After the reviewer records evidence and closes the issue, the next scheduled
   run opens the next queue item.
5. Once every queue item has a closed issue, later runs exit successfully
   without creating duplicates.

Closing an issue is the explicit completion signal. Reviewers must not close an
issue merely because 15 minutes elapsed. GitHub Actions cannot inspect the code
and certify the checklist on the reviewer's behalf.

The repository `GITHUB_TOKEN` is sufficient. The workflow grants only
`contents: read` and `issues: write`; it does not need a personal access token.

## Completing a rotation

Use the checklist in the generated issue. Before closing it, record the files
and workflows reviewed, exact commands run, verified findings, improvement
ideas, follow-up issue links, and scope that remains. Leave an incomplete issue
open even after 15 minutes: the next run will wait rather than claiming that
the review is complete.

## Queue maintenance

- Keep the queue aligned with the active pass in `docs/app-review/PROGRESS.md`.
  When this coordinator is introduced partway through a pass, omit features
  already completed rather than reopening them under a second tracking system.
- Keep feature IDs unique and stable. Closed issues are the durable progress
  record, so renaming an ID makes that feature appear new.
- Append new review areas instead of inserting urgent work ahead of an active
  issue. Reordering unfinished entries changes their future execution order.
- Validate changes locally with:

  ```bash
  python3 scripts/application_review_rotation.py --validate
  python3 -m unittest discover -s scripts -p 'test_application_review_rotation.py' -v
  ```

- A repository administrator can pause the cadence by disabling the workflow
  in GitHub Actions. Re-enabling it resumes from the first unfinished item.

GitHub Actions scheduled runs use UTC, run only from the default branch, and
can start later than the requested minute during high service load. The manual
trigger is available when an immediate retry is needed.
