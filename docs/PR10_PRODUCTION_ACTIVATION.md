# PR-10 — Production activation preflight

## Зачем

PR-08 и PR-09 дали OAuth-защищённый MCP и MCP Apps UI, но локальный CI **не доказывает**, что ComicChat уже доступен как production-плагин ChatGPT.

Этот этап делает границу явной и добавляет безопасный ручной smoke для уже развёрнутого публичного MCP endpoint.

## Что проверяет автоматический CI

`npm run activation:pr10` проверяет только инварианты репозитория:

- production smoke запускается исключительно вручную через `workflow_dispatch`;
- endpoint обязан быть `https://`;
- placeholder URL отклоняются;
- workflow не содержит service-role/OpenAI secrets;
- корневой README больше не утверждает, что уже реализованные PR отсутствуют;
- activation checklist остаётся явным и не выдаёт локальный smoke за production acceptance.

## Ручной public-HTTPS smoke

После реального deploy запустить GitHub Actions workflow **Production MCP preflight** и передать:

```text
https://<project>.supabase.co/functions/v1/comicchat-mcp
```

Workflow переиспользует `supabase/tests/pr08_mcp_oauth_smoke.sh` и проверяет:

1. неавторизованный MCP initialize возвращает `401`;
2. `WWW-Authenticate` содержит Bearer challenge и `resource_metadata`;
3. protected-resource metadata доступен публично;
4. metadata объявляет хотя бы один authorization server.

## Что этот smoke не доказывает

Даже зелёный public-HTTPS smoke не закрывает production acceptance. До заявления «ComicChat работает внутри ChatGPT» нужны:

1. Production Supabase OAuth 2.1 и DCR (или совместимая явная регистрация клиента) с корректным asymmetric JWT signing.
2. Развёрнутый frontend consent route на production Site URL.
3. Проверка **двух независимых ComicChat-аккаунтов**: A не читает B-внешние беседы, B не читает A-внешние; send остаётся idempotent.
4. Подключение endpoint в **реальном ChatGPT** и проверка global/thread Plugin Extension UI.
5. Desktop/mobile проверка состояния, reconnect и повторной отправки.
6. Dedicated UI origin и минимальный **CSP** для production submission.
7. Финальная упаковка `plugin.json` / `mcp.json` только с реально зарегистрированным production server ID/URL.

Ни токены пользователей, ни service-role ключи, ни OpenAI API key в этот workflow не передаются.

## Следующий шаг после зелёного public smoke

Провести двухаккаунтный OAuth + RLS acceptance против production/staging, затем зарегистрировать private plugin package и проверить UI в ChatGPT. До этого состояние проекта — **production-ready foundation, activation pending**.
