# PR-26 — conversation-scoped character reference continuity

Date: 2026-10-08  
Base: `main@204475926d26f40a4abb8e3e9b082f38895511f9`

## Goal

Improve visual character continuity between comic panels without building a custom identity model, embedding service, face database, or image-conditioning stack.

PR-26 reuses the provider-native OpenAI Images Edit path:

```text
first successful real panel
  -> private comicchat-art object
  -> immutable reference for same sender + same conversation

later panel from that sender in that conversation
  -> private reference download by trusted worker
  -> OpenAI images.edit(reference + new scene prompt)
  -> new private comicchat-art object
```

If no reference exists yet, the existing PR-25 `images.generate` path remains the first-frame fallback.

## Reuse decision

### Rakazo Market

A live Market Resolver search for character consistency / reference-image editing returned no relevant implementation. The Skill search also returned no task-specific image-consistency workflow.

### Official capability reused

The official OpenAI Images API supports image editing with GPT Image models and accepts image inputs. The JavaScript/TypeScript SDK exposes `images.edit` and `toFile`, so ComicChat can pass an already-private prior image directly instead of inventing a custom visual-identity subsystem.

Official references:

- OpenAI Images edit API: https://developers.openai.com/api/reference/resources/images/methods/edit
- OpenAI image prompting guide: https://developers.openai.com/api/docs/guides/image-generation/image-prompting
- OpenAI JavaScript/TypeScript Images examples: https://developers.openai.com/api/docs/guides/image-generation

PR-26 intentionally does not set an `input_fidelity` option. The current model path is kept to the documented common edit surface rather than assuming an option whose exact support for this model was not needed for the fast-track slice.

## Privacy scope: same sender + same conversation

The first idea was a global per-user reference. That was rejected.

A prior comic panel contains a scene/background derived from one private conversation. Reusing that image as a reference in another private conversation could carry incidental visual context across chat boundaries.

Therefore the database key is:

```text
(user_id, conversation_id)
```

The reference for Alice speaking with Bob is never automatically used when Alice speaks with Charlie.

A future global character profile should use a separately reviewed neutral portrait/reference asset instead of a private conversation panel.

## Immutable first-success pin

`public.comic_character_reference` stores only:

- `user_id`;
- `conversation_id`;
- `source_message_id`;
- `created_at`.

It stores no URL, bucket name, storage key, signed URL, provider locator, embedding, face vector, or prompt text.

`comic_pin_character_reference(message_id)` is service-role only and accepts a source only when:

- the source message exists;
- the matching generation job is `ready`;
- the provider is `openai-image`;
- job sender/conversation identity matches the message.

The first successful source wins:

```sql
ON CONFLICT (user_id, conversation_id) DO NOTHING
```

Later panels cannot silently replace the established reference.

Ordinary authenticated users have no table read/write grant. The reference is trusted-worker metadata, not a new profile API.

## Render behavior

For a queued sender-owned message, `comicchat-render`:

1. claims the exact generation job as before;
2. loads the message and provider config;
3. looks for a pinned reference with the **same sender and same conversation**;
4. if none exists, calls `images.generate`;
5. if one exists, downloads the prior raw WebP from the existing private `comicchat-art` bucket;
6. converts the bytes with the official SDK `toFile`;
7. calls `images.edit` with a prompt that asks the provider to preserve:
   - face/identity;
   - apparent age;
   - hairstyle;
   - glasses/accessories;
   - clothing silhouette;
   - color anchors;
   - overall rendering style;
8. asks for a new composition/background for the current message;
9. still forbids letters, captions, labels, logos, watermarks and speech bubbles;
10. stores the new WebP in private storage;
11. completes the existing job;
12. best-effort pins the first successful panel for that sender/conversation.

The exact original text is still overlaid by ComicChat and is not read back from the image.

## One provider call per generation attempt

When a reference exists, PR-26 **does not silently fall back** from `images.edit` to `images.generate` inside the same attempt.

That matters for accounting: one GenerationJob attempt should not unexpectedly make two billable image calls.

If reference lookup/download/edit fails, the existing bounded retry state machine handles the failure. A later retry may call edit again, but it is a separately recorded attempt.

When no reference exists at the start of the attempt, the first-frame `images.generate` path remains valid.

## Output descriptor

No reference locator or source message ID is exposed through the generation descriptor.

The only new safe metadata is the mode:

- `seed-profile` — no pinned reference existed;
- `conversation-reference` — provider-native edit used the private pinned reference.

The PR-19 locator guard remains active.

## Failure and recovery

Reference pinning happens after the image job has been completed successfully.

If pinning metadata fails after a panel is already ready, ComicChat logs only a generic operational message and does not roll back the completed user message. The next frame can still use the deterministic seed-profile path until a valid reference is available.

A missing private reference object is treated as a render failure/retry condition rather than silently switching billing behavior.

## Verification

PR-26 adds PostgreSQL integration proving:

- unready jobs cannot be pinned;
- the first ready OpenAI-backed panel becomes the reference;
- a later ready panel in the same sender/conversation cannot replace it;
- the same user gets a separate reference in another conversation;
- the other sender in the same conversation gets a separate reference;
- authenticated A/B/C clients cannot directly read the reference metadata.

Static CI proves:

- official `images.edit` and `toFile` are used;
- lookup is both sender- and conversation-scoped;
- no public/signed URL helper is added;
- no unverified `input_fidelity` option is assumed;
- reference IDs are not exposed in output descriptors.

CI does not call the real OpenAI API.
