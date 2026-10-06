#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
B="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"
C="cccccccc-cccc-4ccc-8ccc-ccccccccccc3"
MESSAGE_NONCE="13131313-1313-4313-8313-131313131313"
OWN_NONCE="14141414-1414-4414-8414-141414141414"
REPORT_NONCE="15151515-1515-4515-8515-151515151515"
SECOND_REPORT_NONCE="16161616-1616-4616-8616-161616161616"
OTHER_REPORT_NONCE="17171717-1717-4717-8717-171717171717"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'report-a@example.test'),
  ('${B}', 'report-b@example.test'),
  ('${C}', 'report-c@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'reportalpha', 'report-a@example.test'),
  ('${B}', 'reportbravo', 'report-b@example.test'),
  ('${C}', 'reportcharlie', 'report-c@example.test');
SQL

user_scalar() {
  local user_id="$1"
  local statement="$2"

  {
    cat <<SQL
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '${user_id}', false);
${statement}
SQL
  } | "${PSQL[@]}" | tail -n 1
}

CONVERSATION_ID="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);")"
[[ -n "${CONVERSATION_ID}" ]]

MESSAGE_ID="$(user_scalar "${B}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${MESSAGE_NONCE}'::uuid, 'message to report');")"
[[ -n "${MESSAGE_ID}" ]]

REPORT_ID="$(user_scalar "${A}" "SELECT id FROM public.comic_report_message('${MESSAGE_ID}'::uuid, '${REPORT_NONCE}'::uuid, 'harassment', 'Repeated unwanted contact');")"
[[ -n "${REPORT_ID}" ]]

REPORT_RETRY_ID="$(user_scalar "${A}" "SELECT id FROM public.comic_report_message('${MESSAGE_ID}'::uuid, '${REPORT_NONCE}'::uuid, 'harassment', 'Repeated unwanted contact');")"
[[ "${REPORT_RETRY_ID}" == "${REPORT_ID}" ]]

if user_scalar "${A}" "SELECT id FROM public.comic_report_message('${MESSAGE_ID}'::uuid, '${REPORT_NONCE}'::uuid, 'spam', 'Changed payload');" >/dev/null 2>&1; then
  echo "report nonce conflict unexpectedly succeeded" >&2
  exit 1
fi

DEDUPED_ID="$(user_scalar "${A}" "SELECT id FROM public.comic_report_message('${MESSAGE_ID}'::uuid, '${SECOND_REPORT_NONCE}'::uuid, 'spam', 'Second attempt');")"
[[ "${DEDUPED_ID}" == "${REPORT_ID}" ]]

A_VISIBLE="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_abuse_report WHERE id = '${REPORT_ID}'::uuid;")"
[[ "${A_VISIBLE}" == "1" ]]

A_LISTED="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_list_my_reports() WHERE report_id = '${REPORT_ID}'::uuid;")"
[[ "${A_LISTED}" == "1" ]]

B_VISIBLE="$(user_scalar "${B}" "SELECT COUNT(*) FROM public.comic_abuse_report WHERE id = '${REPORT_ID}'::uuid;")"
[[ "${B_VISIBLE}" == "0" ]]

B_LISTED="$(user_scalar "${B}" "SELECT COUNT(*) FROM public.comic_list_my_reports() WHERE report_id = '${REPORT_ID}'::uuid;")"
[[ "${B_LISTED}" == "0" ]]

REPORT_OWNER="$("${PSQL[@]}" -c "SELECT reported_user_id FROM public.comic_abuse_report WHERE id = '${REPORT_ID}'::uuid;")"
[[ "${REPORT_OWNER}" == "${B}" ]]

REPORT_STATUS="$("${PSQL[@]}" -c "SELECT status FROM public.comic_abuse_report WHERE id = '${REPORT_ID}'::uuid;")"
[[ "${REPORT_STATUS}" == "submitted" ]]

OWN_MESSAGE_ID="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${OWN_NONCE}'::uuid, 'my own message');")"
[[ -n "${OWN_MESSAGE_ID}" ]]

if user_scalar "${A}" "SELECT id FROM public.comic_report_message('${OWN_MESSAGE_ID}'::uuid, '${OTHER_REPORT_NONCE}'::uuid, 'other', NULL);" >/dev/null 2>&1; then
  echo "user reported their own message" >&2
  exit 1
fi

if user_scalar "${C}" "SELECT id FROM public.comic_report_message('${MESSAGE_ID}'::uuid, '${OTHER_REPORT_NONCE}'::uuid, 'spam', NULL);" >/dev/null 2>&1; then
  echo "non-member reported a message from another private conversation" >&2
  exit 1
fi

if user_scalar "${A}" "SELECT id FROM public.comic_report_message('${MESSAGE_ID}'::uuid, '${OTHER_REPORT_NONCE}'::uuid, 'not_a_reason', NULL);" >/dev/null 2>&1; then
  echo "invalid report reason unexpectedly succeeded" >&2
  exit 1
fi

if user_scalar "${A}" "SELECT id FROM public.comic_report_message('${MESSAGE_ID}'::uuid, '${OTHER_REPORT_NONCE}'::uuid, 'other', repeat('x', 1001));" >/dev/null 2>&1; then
  echo "oversized report details unexpectedly succeeded" >&2
  exit 1
fi

if user_scalar "${A}" "INSERT INTO public.comic_abuse_report(reporter_id, reported_user_id, conversation_id, message_id, client_nonce, reason) VALUES ('${A}'::uuid, '${B}'::uuid, '${CONVERSATION_ID}'::uuid, '${MESSAGE_ID}'::uuid, '${OTHER_REPORT_NONCE}'::uuid, 'spam') RETURNING id;" >/dev/null 2>&1; then
  echo "authenticated role unexpectedly has direct INSERT on comic_abuse_report" >&2
  exit 1
fi

echo "PR-13 private abuse report integration checks passed."
