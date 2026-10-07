# Contributing

Project workflow baseline: `31 Aug 2021`

Thank you for helping improve this project. Contributions should stay focused,
well-documented, and easy to review.

## Before You Start

- Check existing issues or discussions before opening a new one
- Keep each proposal or fix limited to a single clear goal
- Follow the repository code of conduct in `.github/CODE_OF_CONDUCT.md`

## Reporting Issues

- Describe the problem clearly
- Include reproduction steps when possible
- Share expected behavior and actual behavior
- Add screenshots or logs only when they help explain the issue

## Reuse-First Development

ComicChat is a separate product. External developer tooling, including Rakazo Market Skills/Resolver, may accelerate implementation but does not become a ComicChat runtime dependency by default.

Before substantial feature work, follow [the reuse-first fast-track](../docs/FAST_TRACK_REUSE.md): search for a maintained implementation and reusable Skill/workflow first, adapt second, and create custom infrastructure only when a documented ComicChat-specific incompatibility remains.

## Pull Requests


- Use a dedicated branch for each change
- Keep pull requests scoped and easy to validate
- Explain why the change is needed, not only what changed
- Update documentation when behavior or setup changes
- Run local checks before requesting review

## Review Expectations

- Feedback should remain respectful and specific
- Follow-up commits should address review comments directly
- Large changes may be asked to split into smaller pull requests

## License

By contributing to this repository, you agree that your submitted changes are
released under the MIT License included in `LICENSE`.
