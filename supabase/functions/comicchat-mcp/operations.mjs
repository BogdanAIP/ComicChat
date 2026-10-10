// Fixed capability list shared by the widget and authenticated MCP boundary.
// Never accept a caller-supplied SQL statement, table name, or arbitrary RPC.
export const READ_OPERATIONS = [
  'comic_get_my_preferences', 'comic_list_message_styles', 'comic_list_direct_conversations', 'comic_list_blocked_users',
  'comic_get_my_account_state', 'comic_get_beta_safety_status',
  'comic_list_groups', 'comic_list_group_invitations',
  'comic_list_group_members', 'comic_search_users', 'comic_read_message_page',
  'comic_read_message', 'comic_get_conversation_style',
  'comic_list_public_snapshot_requests', 'comic_read_publication_preview',
  'comic_list_released_episodes', 'comic_list_public_group_episodes',
  'comic_list_group_episodes', 'comic_export_my_data',
]
export const WRITE_OPERATIONS = [
  'comic_set_my_preferences', 'comic_mark_conversation_delivered', 'comic_mark_conversation_read',
  'comic_ensure_direct_conversation', 'comic_send_message',
  'comic_block_user', 'comic_unblock_user', 'comic_report_message',
  'comic_request_account_deletion', 'comic_cancel_account_deletion',
  'comic_set_conversation_style', 'comic_create_group', 'comic_join_group',
  'comic_invite_group_user', 'comic_leave_group', 'comic_propose_public_snapshot',
  'comic_set_public_snapshot_consent', 'comic_cancel_public_snapshot_request',
  'comic_release_approved_episode', 'comic_compile_group_episode',
  'comic_publish_group_episode',
]
export function makeOperationSchemas(z) {
  const uuid = z.string().uuid()
  const title = z.string().trim().min(1).max(200)
  const cid = { p_conversation_id: uuid }
  const gid = { p_group_id: uuid }
  const rid = { p_request_id: uuid }
  const definitions = {
    comic_get_my_preferences: {}, comic_list_message_styles: cid,
    comic_set_my_preferences: { p_locale: z.enum(['ru','en','ar']), p_theme: z.enum(['classic','manga','anime','superhero','cartoon']) },
    comic_list_direct_conversations: {},
    comic_list_blocked_users: {}, comic_get_my_account_state: {},
    comic_get_beta_safety_status: {}, comic_list_groups: {},
    comic_list_group_invitations: {}, comic_export_my_data: {},
    comic_list_group_members: gid,
    comic_search_users: { p_query: z.string().trim().min(2).max(100) },
    comic_read_message_page: { ...cid, p_limit: z.number().int().min(1).max(100).default(50),
      p_before_created_at: z.string().datetime({ offset: true }).optional(), p_before_id: uuid.optional() },
    comic_read_message: { p_message_id: uuid },
    comic_get_conversation_style: cid, comic_list_public_snapshot_requests: cid,
    comic_read_publication_preview: rid,
    comic_list_released_episodes: { p_limit: z.number().int().min(1).max(100).default(30) },
    comic_list_public_group_episodes: { p_limit: z.number().int().min(1).max(100).default(30) },
    comic_list_group_episodes: { ...gid, p_limit: z.number().int().min(1).max(100).default(30) },
    comic_mark_conversation_delivered: cid, comic_mark_conversation_read: cid,
    comic_ensure_direct_conversation: { partner_id: uuid },
    comic_send_message: { ...cid, p_client_nonce: uuid,
      p_original_text: z.string().min(1).max(4000).refine(v => Boolean(v.trim()), 'Text required') },
    comic_block_user: { p_user_id: uuid }, comic_unblock_user: { p_user_id: uuid },
    comic_report_message: { p_message_id: uuid, p_client_nonce: uuid,
      p_reason: z.enum(['spam', 'harassment', 'threats', 'sexual_content', 'hate', 'self_harm', 'other']),
      p_details: z.string().max(2000).nullable().optional() },
    comic_request_account_deletion: {}, comic_cancel_account_deletion: {},
    comic_set_conversation_style: { ...cid,
      p_primary_style_id: z.enum(['anime', 'manga', 'superhero', 'cartoon', 'romance']),
      p_secondary_style_id: z.enum(['anime', 'manga', 'superhero', 'cartoon', 'romance']).nullable(),
      p_secondary_weight: z.number().int().min(0).max(90) },
    comic_create_group: { p_title: z.string().trim().min(3).max(80),
      p_visibility: z.enum(['closed', 'public']) },
    comic_join_group: { ...gid, p_accept_public_reuse: z.boolean() },
    comic_invite_group_user: { ...gid, p_user_id: uuid }, comic_leave_group: gid,
    comic_propose_public_snapshot: { ...cid, p_through_message_id: uuid },
    comic_set_public_snapshot_consent: { ...rid, p_consented: z.boolean() },
    comic_cancel_public_snapshot_request: rid,
    comic_release_approved_episode: { ...rid, p_title: title },
    comic_compile_group_episode: { ...gid, p_message_ids: z.array(uuid).min(1).max(100),
      p_title: title },
    comic_publish_group_episode: { p_episode_id: uuid },
  }
  const union = names => z.discriminatedUnion('operation', names.map(operation =>
    z.object({ operation: z.literal(operation), args: z.object(definitions[operation]).strict() }).strict()))
  return { read: union(READ_OPERATIONS), write: union(WRITE_OPERATIONS) }
}
