# ComicChat: продуктовый и технический аудит — 10 октября 2026

## Вывод

Проект не требуется пересоздавать. Рабочая основа личных и групповых переписок уже есть; проблемы находятся в согласованности выпусков, пользовательских сценариях и нескольких серверных правилах. Текущий продукт нельзя считать готовым к открытому запуску только по зелёному CI.

Главные блокеры: сервер публикации расходится с показанным запретом; художественный romance не связан с требованием приватности соответствующих групп; история миграций расходится с файлами; сайт и MCP показывают разные версии. Основные UX-проблемы: вложенная навигация сайта в панели GPT, отсутствие общих настроек, плохо обнаруживаемые EN/AR без RU, открытая собственная почта, смешение технических статусов с перепиской и отсутствие тем интерфейса.

Это аудит, а не выполненное исправление приложения. В ходе этой проверки прикладной код, права, публикации и платная генерация не изменялись. Создан отдельный отчёт. Вход тестового Alpha выполнялся существующим QA-помощником, который также обновляет его синтетический username.

## Проверенная версия и ограничения

| Поверхность | Проверенное состояние | Значение |
| --- | --- | --- |
| GitHub main | b22da9de86f917f50ec3e50e108675845714950a; PR39 объединён | Часть вчерашних исправлений уже реализована |
| Общий UI и MCP | 5e82340a1bf661985646f0be692d0e28160ab965; draft PR41 | Уже использует компоненты существующего сайта; это не новый проект с нуля |
| MCP deployment | staging Supabase, импорт закреплён на 5e82340 | Код сервера связан с точным коммитом, зависимости ещё используют диапазоны версий |
| Сайт | comicchat-staging.vercel.app/en | Live UI содержит старые открытые beta diagnostics, отличающиеся от новой MCP-сборки |
| Supabase | qbqfxuijnispicvazmgj | Проверен через авторизованный браузер R, read-only SQL Editor |
| Параллельная ветка | draft PR40, head 5900fac на момент проверки | Незавершённый отдельный поток; его изменения не смешивались с аудитом |

Снимок RLS/истории миграций получен 09:05 UTC; действующие определения серверных функций повторно проверены позднее в этой сессии. Секреты, чужая переписка и реальные адреса в отчёт не включены.

Доказательства обозначены: **LIVE** — действующий интерфейс/БД; **CODE** — установленная ветка 5e82340; **RISK** — вывод по пути кода, ещё без отдельного воспроизведения крайних условий. Fixture MCP проверяет адаптер и отображение, но не заменяет настоящую авторизацию GPT.

## Приоритетные находки

P0 — закрыть перед открытым запуском. P1 — обязательная продуктовая доработка. P2 — последующее укрепление. Приоритет не означает, что эксплуатация уже произошла.

| ID | Приоритет | Находка и доказательство | Требуемое изменение |
| --- | --- | --- | --- |
| A01 | P0 | LIVE: comic_get_beta_safety_status возвращает public_publication_enabled=false. Действующая comic_publish_group_episode после авторства и eligibility устанавливает public без проверки этого флага | Единый серверный источник capability и реальная проверка в write RPC; сообщения UI должны соответствовать возможностям |
| A02 | P0 | LIVE: comic_set_conversation_style допускает romance в публичной группе; eligibility проверяет visibility и adult_theme, но не этот стиль/политику контента | Согласовать отдельную категорию группы с правилом пользователя: закрытые и flirt/adult эпизоды остаются group-only. Проверять сервером создание, стиль, компиляцию, публикацию и чтение |
| A03 | P0 | LIVE: версии migration history отличаются от имён в репозитории; есть отдельные audit worker/legacy SQL изменения | Сверить содержимое и конечную схему, собрать воспроизводимый baseline; исправлять tracking только после сравнения. Не запускать вслепую db push/repair/reset |
| A04 | P0 | LIVE/CODE: сайт, main, draft MCP и draft подключения обновлены раздельно; staging E2E job пропущен | Единый release manifest, совместимость контрактов, staging smoke для всего выпуска и доказательство конкретного deployed SHA |
| A05 | P1 | LIVE/CODE: собственная почта показана в навигации и профиле; при отсутствии username сервер может использовать email как имя | В основном UI показывать display name/handle. Email — только в приватных настройках аккаунта, с маскировкой по умолчанию; исключить из названий и публичных DTO |
| A06 | P1 | CODE/LIVE: нет отдельного Settings; экспорт/удаление/beta limits находятся в списке личных чатов | Общий экран настроек: аккаунт, язык, внешний вид, приватность и данные; диагностика в админском/служебном доступе |
| A07 | P1 | CODE/LIVE: EN/AR существуют, переключатель подписан следующим языком; RU отсутствует; MCP начинается с en и не сохраняет выбор | RU/EN/AR, явное «Язык», первоначальный host locale, сохранение предпочтения, полная локализация текстов и дат |
| A08 | P1 | CODE: ComicStylePicker изменяет стиль будущих сообщений, глобальная тема одна | Отдельные личные темы интерфейса с превью; не менять замороженный рисунок старых сообщений |
| A09 | P1 | CODE/LIVE: desktop rail справа фиксирован 270px; внутри GPT появляется дополнительный уровень навигации рядом с внешней панелью | Общие feature-компоненты, разные оболочки website и GPT; узкая ширина — один экран; управление полноэкранным режимом через возможности host |
| A10 | P1 | CODE: MCP Logout возвращает инструкцию управлять подключением в настройках ChatGPT | Capability-aware действие «Управлять подключением», либо поддержанный выход. Кнопка не должна обещать неподдерживаемый результат |
| A11 | P1 | CODE: MCP facade отключает методы загрузки artwork, хотя общий UI и сервер сообщают media enabled | Контракт artwork в GPT или честное capability UI; не показывать действие с гарантированным unavailable |
| A12 | P1 | LIVE/CODE: idle/polling, провайдер, хранение, очистка и UUID оказываются в пользовательском потоке; raw error.message выводится в ряде мест | Оставить понятные статусы, локализованные ошибки и приватный correlation ID; технические подробности — отдельная диагностика |
| A13 | P1 | LIVE: username не имеет уникального индекса/форматных ограничений; сейчас дубликатов нет, один профиль без имени | Разделить необязательное отображаемое имя и уникальный нормализованный handle; серверная проверка, понятная занятость имени |
| A14 | P1 | CODE: owner не может leave, RPC требует owner_transfer_required; передачи владельца/удаления участников в проверенных UI/RPC нет | Завершить жизненный цикл групп: управление участниками, передача владельца или архивирование, обработка удаления аккаунта |
| A15 | P1 | CODE: членство грузится при выборе группы; приглашения/список не везде автоматически обновляются | Обновление приглашений и состава, состояние отозванного доступа; серверная перепроверка каждой операции и очистка UI при отзыве |
| A16 | P1 | CODE/RISK: refreshLatest читает только последние 50; после длинного офлайна может оставить пропущенную середину | Watermark/cursor catch-up до ранее известной границы; тест с более чем 50 новыми сообщениями |
| A17 | P2 | CODE/RISK: refreshLatest выставляет hasOlder по длине последней страницы, переопределяя уже достигнутый конец истории | Разделить курсор старой истории и refresh новых сообщений; тест «дошёл до начала → polling» |
| A18 | P1 | CODE: jsonResult дублирует профиль и большие результаты в content и structuredContent | Минимизация model-visible данных; UI-only поля передавать по поддержанному widget metadata контракту; не копировать email и всю историю без необходимости |
| A19 | P2 | CODE: одинаковые destructive annotations для разных app-only write операций; generic open не имеет полноценного group destination | Точные схемы и аннотации операций, explicit target type/id; проверка фокуса нужной группы в GPT |
| A20 | P1 | LIVE/CODE: purge/hard delete выключены, срок хранения не определён; request deletion не равен стиранию | Честный сценарий запроса, документированный срок и lifecycle; не показывать обещание немедленного удаления |
| A21 | P2 | CODE: export RPC прежней версии выгружает сообщения и memberships, но нет новых settings/групповых профилей/эпизодов/стилей | Версионировать экспорт; включать новые пользовательские сущности и исключать worker secrets; проверить размер и асинхронную выгрузку |
| A22 | P2 | CODE: старые Chat/DirectMessages/audio/upload компоненты и nodemailer сохраняются; CSS содержит старые и новые overrides | Удаление после проверки графа импортов; единые design tokens и компоненты. Наличие старых файлов само по себе не доказывает уязвимость |
| A23 | P2 | CODE: Deno/npm зависимости MCP используют caret, Deno lock не найден | Закрепление зависимостей и сборка артефактов с hash; проверка чистого rebuild и совместимости SDK |
| A24 | P1 | CODE: QA group fixture использует role вместо my_role и member_role | Схемы fixture из действительного RPC-контракта; тесты owner controls и denial, а не только create/send |

### A01: флаг публикации — подтверждённый серверный конфликт

Read-only pg_get_functiondef показал:
- beta status возвращает фиксированное FALSE для публичной публикации;
- publish проверяет auth, account state, created_by и comic_group_episode_public_eligible;
- eligibility проверяет public group, NOT adult_theme, наличие creator membership, принадлежность выбранных сообщений и принятие версии условий авторами до создания сообщений;
- затем write RPC обновляет visibility='public', published_at=NOW(). Флаг beta не участвует.

Не проверялась фактическая публикация чужого или нового контента. Здесь вывод о действующем пути кода, а не о состоявшейся утечке. Public feed в этой модели также требует авторизации: «публично» внутри приложения не следует автоматически называть доступом всего интернета.

Источник: supabase/migrations/20261009001000_pr37_group_episode_compiler.sql и live function definitions. Решение: если публикация разрешена по плану проекта, исправить статус и согласованные capability; если выключена — enforce сервером. Любое решение должно сохранять private/flirt policy.

### A02: romance и приватность — разные несвязанные сущности

В comic_group_profile есть adult_theme и ограничение adult => closed. Установка художественного стиля owner проверяется, но romance может стать primary или secondary в public group без обращения к этой политике. Из-за этого требование «flirt группы и эпизоды только внутри группы» не выражено сквозным инвариантом.

Романтический визуальный стиль сам по себе не доказывает взрослое содержимое. Нельзя приравнивать персональную розовую тему UI к adult group. Нужна отдельная content_policy группы, понятное обозначение режима и серверные правила, включая смешанные стили и старые frozen panels. Проверка должна работать при прямом вызове RPC, независимо от кнопок.

Источник: 20261008230000_pr36_group_chat.sql, 20261009014000_pr38_comic_style_skills.sql, 20261009001000_pr37_group_episode_compiler.sql; подтверждено live SQL.

### A03–A04: управляемый выпуск вместо ручного набора обновлений

Примеры расхождений history: PR36 в репозитории 20261008230000, live 20261008201149; PR37 20261009001000 против 20261008233719; audit fixes 20261009063333 против 20261009071909. Live worker schedule и legacy hardening имеют отдельные migration entries.

Это не доказательство, что текущая схема неработоспособна: применённые определения проверяются отдельно. Это риск повторного развёртывания, последовательности upgrades и восстановления окружения.

Порядок восстановления:
1. Read-only inventory: applied SQL, function definitions, grants, RLS, triggers, extensions, cron и private buckets.
2. Сопоставить каждое изменение с Git SQL и хешами содержимого; сделать explicit mapping history.
3. Проверить чистую локальную БД из portable baseline и upgrade с прежней схемы.
4. Подготовить tracking repair как отдельный проверяемый шаг; не переигрывать applied DDL на live.
5. Release manifest: app SHA, UI bundle hash, MCP tool/schema version, DB baseline version, Edge Functions SHA и effective capabilities.
6. Выпускать согласованный staging, затем проверять website + настоящую GPT UI + четыре роли пользователей.

## Что уже работает и должно сохраниться

- LIVE: у всех 21 проверенных public tables включён RLS; anon SELECT отсутствует.
- LIVE: profile SELECT/INSERT/UPDATE ограничены id=auth.uid(). У anon не обнаружены callable comic security-definer RPC.
- LIVE: search users, group members, direct conversation lists и public group episode DTO не возвращают email.
- CODE: MCP auth bound к действительному пользователю; переданный accountId сверяется; операции RPC ограничены whitelist; sender не назначается произвольно.
- Личные и закрытые группы имеют серверную проверку членства; предыдущая QA-серия с Alpha/Bravo/Charlie/Outsider подтвердила обмен и отказ outsider для закрытой группы. В текущем аудите live Alpha также видел ответ Bravo.
- Exact original_text остаётся доступным; retry использует client_nonce; история имеет keyset pagination.
- PR39 уже исправил browser-dependent generation: есть отдельный worker, lease ownership, retries/backoff и cron. Не следует повторно описывать старую проблему как текущую.
- Private storage и авторизованный story-art resolver проверяют viewer, не публикуют private URL; ответы artwork используют no-store.
- Замороженный художественный стиль сообщений и episodic snapshots позволяют сохранять историю без перерисовки при смене текущего стиля.
- Общие components ComicDirectMessages/ComicGroupChat/Profile реально используются в новой MCP UI.
- Есть reduced-motion и часть keyboard/focus/mobile исправлений.

RLS и deny-default — хорошие базовые меры. Они не являются сертификатом безопасности всех функций. Приватность здесь обеспечивается авторизацией серверного сервиса; E2EE не реализовано. Не обещать защиту от сохранения или скриншотов уже отображённого контента.

## Сравнение с практиками и целевой UI

| Область | Практика / источник | Применение к ComicChat |
| --- | --- | --- |
| Встраиваемый UI | OpenAI: компактное содержимое в inline, полноценные задачи в расширенном режиме; избегать вложенного приложения с глубокой навигацией | Inline — конкретный чат/краткое приглашение; общий inbox и групповой редактор — подходящий расширенный режим |
| Адаптивность | WCAG 2.2: reflow, текст, клавиатура, видимый focus, достаточные контраст и цели | Проверять узкую панель и телефон, RTL, масштабирование; один выбранный экран и понятный Back |
| Приватная идентичность | Signal: отделять приватный идентификатор аккаунта от способа найти пользователя | Auth email остаётся приватным; люди общаются по имени/handle и приглашению |
| Второстепенные функции | NN/g: progressive disclosure | Экспорт, удаление, техническая справка живут в Settings; первичны разговор, отправка и чтение |
| Авторизация | OWASP и Supabase: минимум прав, deny default, проверка ресурса при каждом запросе | Все write/read RPC enforce membership, policy, account state и effective feature gates |
| Миграции | Supabase: согласованная история Git и remote | Воспроизводимый baseline и проверенный upgrade; dashboard changes отражаются в Git |
| Наблюдаемость | OWASP Logging | Event/code/latency/correlation; без токенов, email и полных личных сообщений в логах |

Положение внешней панели определяет ChatGPT. Нельзя обещать CSS-перенос контейнера GPT налево. Наш вклад — убрать внутреннюю правую полосу, адаптировать содержимое и использовать поддержанные display modes. В действующей OpenAI спецификации есть inline/fullscreen; наличие declaration не гарантирует выбранное host размещение. Нужны capability detection, запрос поддержанного режима и проверка в настоящем ChatGPT.

### Навигация

Общие разделы: **Чаты · Группы · Истории**. Профиль/аватар открывает **Настройки**. Язык и тема доступны там за один переход. Создание разговора/группы — действие в соответствующем разделе.

На широком сайте: основная навигация со стороны начала чтения (LTR слева, RTL справа), список бесед и выбранный чат. На узком сайте и в панели GPT: один экран — список либо выбранная беседа; Back возвращает к списку. Нельзя постоянно сжимать чат между несколькими полосами.

В чате: заголовок, понятный статус приватности, участники/меню, история, composer. Поиск и приглашение принимают handle или user-friendly link вместо требования знать UUID. Сборка эпизода — отдельный понятный этап «Выбрать панели → Проверить → Сохранить», с явным местом доступности.

### Настройки

| Раздел | Состав |
| --- | --- |
| Аккаунт | Display name, уникальный handle, аватар, приватные сведения о подключении |
| Язык | Русский / English / العربية; направление текста и формат дат |
| Внешний вид | Превью тем, выбор оформления, доступность и уменьшение анимаций |
| Приватность | Заблокированные пользователи, правила публичности, данные аккаунта |
| Данные | Экспорт, реальный статус запроса удаления и сроки хранения |
| Справка | Понятное объяснение beta; технические детали только при необходимости |

Почта не отображается в постоянной навигации, заголовках разговоров, публичном профиле или имени по умолчанию. В приватном аккаунт-разделе возможна маска и явное раскрытие владельцем. «Выйти» на website и «Управлять подключением» в GPT отражают разные доступные операции.

### Комиксные темы

Предложение: **Classic Ink, Manga, Anime, Superhero, Cartoon**. Это полноценные token sets: бумага, чернила, рамки, типографика, spacing, акценты и допустимая анимация. Light/dark — вариант доступности внутри темы, а не весь каталог.

Нужны три независимые настройки:
1. **Личная тема интерфейса** — меняет оболочку только у пользователя, сохраняется между website и GPT.
2. **Художественный стиль разговора** — используется при создании новых panels, права зависят от роли; не меняет frozen history.
3. **Политика содержимого/доступности группы** — серверное правило приватности и публикации, не управляется цветом темы.

Account preferences должны иметь self-only storage/RPC и валидируемые locale/theme IDs. Browser cache может помогать быстрому старту, но не подменять аккаунт и не переносить предпочтения/черновики другого пользователя. Каталог тем и стилей версионируется отдельно. Внутри GPT учитывать host colors/theme и доступные размеры, сохраняя комиксный характер содержимого.

### Технический текст

Вместо polling — только понятное временное «Обновляем сообщения», если пользователь действительно ждёт. Idle скрыть. Отправка, доставка, ошибка и готовность рисунка должны быть различимы и не перегружать каждую панель. Диагностика provider/storage/purge не является основным текстом интерфейса.

Оригинальная реплика остаётся читаемой и доступной даже при ошибке рисунка. Доступность не должна требовать распознавать текст исключительно внутри изображения.

## Целевая архитектура

Существующий Next/React + Supabase подходит нынешнему масштабу. Микросервисы или новая БД не обоснованы выявленными проблемами.

- **Domain contract**: канонические DTO и схемы команд для messages, groups, profile, preferences, episodes, capabilities.
- **Общие feature UI**: чат, группа, профиль, настройки, история; отдельные responsive shells website/GPT.
- **Transport adapters**: web authenticated Supabase и MCP user-auth facade с одинаковыми семантикой и проверяемыми результатами.
- **Postgres boundary**: membership/owner/content policy/publication/account state; UI не считается защитой.
- **Generation pipeline**: существующие jobs/leases/worker/private assets; server budgets и opt-in остаются обязательными.
- **Release/observability**: immutable artifacts, миграции, schema compatibility, без персональных данных в логах.

Для MCP нужен capabilities DTO, включающий профиль, publication, private media, generation, logout/connection management и поддержанные методы. Это ответ транспорта поверх серверной политики: interface capability не может разрешить то, что запрещено сервером.

Polling допустим как beta transport, но должен иметь incremental cursor, backoff и прекращаться при скрытом документе. Настоящие host events можно использовать только после проверки поддержанного API. Дополнительные лимиты на поиск/создание/приглашения/жалобы и нагрузка требуют отдельного профилирования; текущий аудит не измерял массовый трафик.

## Проверки и критерии приёмки

### Уже проверено

- Remote рабочая ветка clean на 5e82340 перед аудитом.
- Live SQL: RLS/grants/profile indexes/constraints, отсутствие email в публичных RPC outputs, migration history, effective policy/publication/style/media functions.
- Live staging website: Alpha, список переписок, ответ Bravo, меню, почта и диагностический текст.
- Website viewport 1100 и 390 CSS px: body scrollWidth равен ширине viewport в этих снимках. Это ограниченная проверка, не полная WCAG аттестация.
- MCP fixture на 740px: общий UI, collapsed beta settings, menu/profile с синтетической почтой; переключение раздела работает после render. First attempt nav wait ожидал скрытый nav и истёк; затем использован явный menu flow.
- Live GitHub PR41: выполненные build/security/OAuth/realtime/browser/shared iframe jobs успешны; staging two-account job SKIPPED.
- Предыдущая серия QA на staging: три участника закрытой группы, outsider denial, публичная группа с явным join consent, DM. Это историческое свидетельство предыдущей проверки, а не повтор всех действий во время данного аудита.

### Обязательный следующий gate

| Сценарий | Условие успеха |
| --- | --- |
| GPT и website | Одинаковые contract/release версии; работают реальные доступные artwork и действия |
| Четыре роли | Alpha owner, Bravo/Charlie members, Outsider; каждый со своим auth account |
| Отдельные GPT-чаты | Новый GPT-диалог сам по себе не создаёт новый ComicChat account. Для проверки нужны независимые авторизованные подключения/профили |
| Private/public policy | Прямой RPC не публикует закрытые/flirt эпизоды; выключенный gate действительно блокирует запись |
| Consent | Одинаковые условия owner create/public join/model tools; отозванное/неподходящее право не обходится UI |
| Group lifecycle | Invite accept/decline/revoke, leave, owner transfer/archive, удаление участника, отзыв чтения |
| Account switching | Чужие messages, draft, profile, media и preferences исчезают; signed asset access вновь проверяется |
| History | Более 50 новых сообщений после офлайна; начало истории не теряется и не «открывается» снова из-за poll |
| Settings | RU/EN/AR сохраняются, даты/ошибки локализованы; email только в закрытом account view |
| Themes | Все заявленные темы проходят contrast/focus/RTL; персональная тема не меняет чужой UI/старые panels |
| Accessibility | 320/390/740/1100/1440px, 200% text, keyboard, screen reader, reduced motion; реальная GPT панель |
| Release | Fresh DB и upgrade тесты; deployed hashes проверены; staging E2E выполнен, а не skipped |

Не проверены paid generation (отключена), disaster recovery, нагрузочные пределы, полноценный penetration test, все сочетания блокировок и удаления в группах, browser network inspection. Это остаётся явным scope следующих проверок.

## Порядок реализации

1. **Согласованность и политика**: A01–A04, capabilities, migration mapping; fixtures правильных ролей. До этого UI не должен обещать безопасность на основании неверного флага.
2. **Общий продуктовый UI**: настройки, навигация, почта, RU/EN/AR, локализованные статусы, действия connection/logout.
3. **Темы**: design tokens и каталог personal themes; сохранить отдельный conversation art style и content policy.
4. **Полный групповой сценарий**: owner lifecycle, invitations, consent, media parity, incremental history.
5. **Единый выпуск и фактическая GPT проверка**: независимые аккаунты, website+MCP, отрицательные privacy тесты и screenshot review.
6. **Укрепление**: dependency lock, legacy cleanup, export/lifecycle/telemetry, нагрузка и restoration drill.

Каждый этап завершается конкретным работающим результатом. Большая декоративная переделка до A01–A04 оставит существующие расхождения скрытыми под новым оформлением.

## Источники, проверенные 10 октября 2026

- [OpenAI UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines) — host integration, layout, доступность.
- [OpenAI MCP extensions specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md) — display modes и metadata; предпочтение режима не гарантирует размещение.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — contrast, reflow, keyboard, focus, target size. 44px — предлагаемая продуктовая цель, не универсальное требование AA.
- [Signal: usernames and privacy](https://signal.org/blog/phone-number-privacy-usernames/) — сравнение UX идентичности, без переноса обещаний Signal encryption.
- [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) — размещение дополнительных настроек.
- [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) — ресурсные проверки и deny default.
- [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) — минимизация чувствительных логов.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) — права таблиц.
- [Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations) — воспроизводимая история изменений.
- [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization) — доступ к private channels.
- [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions) — cron/Vault worker architecture.

## Код для последующего исправления

pages/index.js; components/Profile.js; components/ComicDirectMessages.js; components/ComicGroupChat.js; components/ComicGroupStoryStudio.js; components/ComicStylePicker.js; components/ComicStoryFeed.js; components/ComicPanel.js; utils/useComicMessages.js; utils/useTranslation.js; next.config.js; styles/globals.css; styles/Sidebar.module.css; styles/ComicDirectMessages.module.css; mcp-ui/main.jsx; mcp-ui/client.mjs; mcp-ui/next-router.jsx; mcp-ui/qa-host-script.js; scripts/mcp-ui-browser-test.mjs; supabase/functions/comicchat-mcp/index.ts; supabase/functions/_shared/comic-image-worker.ts; supabase/functions/comicchat-worker/index.ts; supabase/functions/comicchat-story-art/index.ts; supabase/migrations/20261007163000_pr15_self_service_data_export.sql; 20261007234500_pr22_beta_safety_disclosure.sql; 20261008230000_pr36_group_chat.sql; 20261009001000_pr37_group_episode_compiler.sql; 20261009014000_pr38_comic_style_skills.sql; 20261009063333_audit_fixes.sql.
