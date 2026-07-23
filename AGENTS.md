# Project release checkpoint policy

When a version or named checkpoint is completed:

1. Run the relevant validation checks.
2. Commit the intended source and documentation changes.
3. Push the current branch to `origin`.
4. Report the branch name and commit identifier to the user.

Do not describe a version as saved or complete if the push has not succeeded.
If pushing is blocked, report the blocker explicitly instead of leaving the
checkpoint only in the local repository.
