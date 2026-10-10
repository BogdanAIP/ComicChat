# ComicChat UI and ChatGPT illustrations

The existing app had a fixed right navigation panel, no account settings and no readable text view next to its comic panels. This change reuses the same website components inside the MCP app and adds horizontal navigation, settings for RU/EN/AR and five comic interface themes, hidden account email, and a collapsible original-text conversation panel sharing the existing composer/history.

Private-message art is requested through the host's ChatGPT message capability, or by copying a ChatGPT prompt on the website. An authenticated sender can attach an existing PNG/JPEG/WebP to that message without creating another message or calling a paid image API. Private Storage, service-only commit, immutable asset IDs, account guards and frozen publication snapshots are reused. The host tool accepts an actual ChatGPT file; automatic generation-to-attachment still needs live ChatGPT verification.

Validation: shared MCP bundle and 9 unit tests pass; Chrome fixture test covers settings, exact multiline message text, drawer, host prompt, group send and account remount/draft isolation. Existing 29 static gates plus lint pass. New PostgreSQL integration is wired into CI for preferences isolation, sender-only commit, exact original text, outsider denial and frozen snapshots. Live staging migration/deployment and independent-account acceptance remain pending; this is a draft.

This branch includes the existing shared MCP UI work from draft PR #41.

Implementation boundaries:
- Text drawer uses canonical messages and preserves exact original text. Existing sent messages are read-only; sent-message revision is not implemented.
- Theme preferences change interface chrome; existing message art/style snapshots remain intact.
- ChatGPT generation depends on actual host support/login and must be verified live. A copied prompt or bridge acceptance is not proof of a generated attachment.
- Group art attachment and expanded authorization providers are outside this first private-DM slice.
- Migration and backend handlers must be deployed together with this UI. Public publication and paid API activation are not enabled by this change.
