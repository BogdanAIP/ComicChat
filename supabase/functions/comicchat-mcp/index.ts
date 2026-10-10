// ComicChat PR-08: authenticated MCP boundary for ChatGPT/Codex.
// Private data stays behind Supabase OAuth 2.1 + existing RLS/RPC policies.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0'
import { pipeline } from 'npm:@supabase/middleware@^1.0.0'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@^1.6.0'
import { z } from 'npm:zod@^4.3.6'
import { COMICCHAT_APP_HTML } from './ui.ts'
import { makeOperationSchemas } from './operations.mjs'
import { attachChatGptArt, readPrivateChatGptArt, readChatGptFile } from '../_shared/chatgpt-art.ts'

const oauth = [{ type: 'oauth2' as const, scopes: ['openid', 'email', 'profile'] }]
const COMICCHAT_APP_URI = 'ui://comicchat/app-v2.html'

function jsonResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  }
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message :
    (error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error))
  throw new Error(message)
}

Deno.serve(
  pipeline(
    [
      withOAuthProtectedResource({
        authorizationServer: Deno.env.get('MCP_AUTH_ISSUER') || undefined,
      }),
      withSupabase({ auth: 'user' }),
    ],
    async (req, { supabase }) => {
      const handler = createMcpHandler(() => {
        const server = new McpServer(
          { name: 'comicchat', version: '0.2.0' },
          {
            instructions:
              'ComicChat is a private comic-first messenger. Resolve the authenticated profile before account-sensitive work. List or find a conversation before reading or sending. Never invent conversation IDs, user IDs, message IDs, or text.',
          }
        )

        // App-only transport for the same website components; database RPCs
        // retain their existing auth.uid(), RLS and consent enforcement.
        const schemas = makeOperationSchemas(z)
        for (const [name, schema, readOnly] of [
          ['comicchat_ui_read', schemas.read, true],
          ['comicchat_ui_write', schemas.write, false],
        ] as const) {
          server.registerTool(name, {
            title: readOnly ? 'Read ComicChat app data' : 'Apply ComicChat app action',
            description: 'Fixed app-only capabilities for the existing ComicChat website UI.',
            inputSchema: { accountId: z.string().uuid(), request: schema },
            annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false },
            securitySchemes: oauth,
            _meta: { ui: { visibility: ['app'] } },
          }, async ({ accountId, request }) => {
            const { data: auth, error: authError } = await supabase.auth.getUser()
            if (authError || !auth.user || auth.user.id !== accountId) fail('Connected account changed. Reopen ComicChat.')
            const { data, error } = await supabase.rpc(request.operation, request.args)
            if (error) fail(error)
            return jsonResult({ data: data ?? null })
          })
        }
        server.registerTool('comicchat_ui_update_profile', {
          title: 'Update my ComicChat username',
          description: 'Update only the authenticated account username from the profile screen.',
          inputSchema: { accountId: z.string().uuid(), username: z.string().trim().min(1).max(80) },
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
          securitySchemes: oauth,
          _meta: { ui: { visibility: ['app'] } },
        }, async ({ accountId, username }) => {
          const { data: auth, error: authError } = await supabase.auth.getUser()
          if (authError || !auth.user) fail(authError || 'Authenticated user missing')
          if (auth.user.id !== accountId) fail('Connected account changed. Reopen ComicChat.')
          const { data, error } = await supabase.from('user').update({ username })
            .eq('id', auth.user.id).select('id, username, email').single()
          if (error) fail(error)
          return jsonResult({ data })
        })

        server.registerTool('comicchat_ui_attach_art', {
          title: 'Attach my ChatGPT illustration', description: 'Attach user-selected image bytes to my own direct message. Does not generate images or call an AI API.',
          inputSchema: { accountId: z.string().uuid(), messageId: z.string().uuid(), imageBase64: z.string().max(11200000) },
          annotations: {readOnlyHint:false,destructiveHint:false,openWorldHint:false}, securitySchemes:oauth,
          _meta:{ui:{visibility:['app']}},
        }, async ({accountId,messageId,imageBase64}) => {
          const {data:auth,error}=await supabase.auth.getUser()
          if(error || auth.user?.id!==accountId)fail('Connected account changed. Reopen ComicChat.')
          const bytes=Uint8Array.from(atob(imageBase64),c=>c.charCodeAt(0))
          return jsonResult({data:await attachChatGptArt(supabase,messageId,bytes)})
        })
        server.registerTool('comicchat_ui_read_art', {
          title: 'Read a private ComicChat illustration', description: 'Return artwork only after current conversation membership is checked.',
          inputSchema:{accountId:z.string().uuid(),messageId:z.string().uuid(),assetId:z.string().uuid()},
          annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},securitySchemes:oauth,
          _meta:{ui:{visibility:['app']}},
        }, async ({accountId,messageId,assetId}) => {
          const {data:auth,error}=await supabase.auth.getUser()
          if(error || auth.user?.id!==accountId)fail('Connected account changed. Reopen ComicChat.')
          const blob=await readPrivateChatGptArt(supabase,messageId,assetId)
          const bytes=new Uint8Array(await blob.arrayBuffer())
          let binary=''
          for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192))
          return {content:[{type:'text' as const,text:'Private illustration loaded.'}],_meta:{imageBase64:btoa(binary),mimeType:blob.type}}
        })
        server.registerTool('attach_chatgpt_illustration', {
          title:'Attach ChatGPT illustration to my message',
          description:'Save an image already created or selected in ChatGPT to an existing sender-owned private message. Never calls a generation API. Resolve the exact message first; retain original text. Ask the user to choose an image if none is attached.',
          inputSchema:{messageId:z.string().uuid(),file:z.object({
            download_url:z.string().url(),file_id:z.string().min(1),mime_type:z.string().optional(),file_name:z.string().optional(),
          })},
          annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true},securitySchemes:oauth,
          _meta:{'openai/fileParams':['file']},
        },async ({messageId,file})=>{
          // Permission before any external file fetch, then checked again at commit.
          const {data:auth,error:authError}=await supabase.auth.getUser()
          const {data:rows,error}=await supabase.rpc('comic_read_message',{p_message_id:messageId})
          const msg=Array.isArray(rows)?rows[0]:rows
          if(authError || !auth.user || error || msg?.sender_id!==auth.user.id)fail('message_unavailable')
          return jsonResult(await attachChatGptArt(supabase,messageId,await readChatGptFile(file)))
        })

        server.registerResource(
          'comicchat-app',
          COMICCHAT_APP_URI,
          {},
          async () => ({
            contents: [
              {
                uri: COMICCHAT_APP_URI,
                mimeType: 'text/html;profile=mcp-app',
                text: COMICCHAT_APP_HTML,
                _meta: {
                  ui: {
                    prefersBorder: false,
                  },
                  'openai/ui': {
                    availableDisplayModes: ['inline', 'fullscreen'],
                  },
                },
              },
            ],
          })
        )

        server.registerTool(
          'open_comicchat_app',
          {
            title: 'Open ComicChat',
            description:
              'Open the authenticated ComicChat inbox UI. Optionally focus one known conversation through the explicit membership-checked read RPC. Foreign and unknown conversation IDs fail uniformly.',
            inputSchema: {
              conversationId: z.string().uuid().optional(),
            },
            outputSchema: {
              profile: z.record(z.string(), z.unknown()),
              conversations: z.array(z.record(z.string(), z.unknown())),
              groups: z.array(z.record(z.string(), z.unknown())),
              invitations: z.array(z.record(z.string(), z.unknown())),
              selectedConversationId: z.string().uuid().nullable(),
              messages: z.array(z.record(z.string(), z.unknown())),
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
            _meta: {
              ui: { resourceUri: COMICCHAT_APP_URI },
              'openai/outputTemplate': COMICCHAT_APP_URI,
              'openai/ui': {
                entrypoints: [{ type: 'global' }, { type: 'thread' }],
              },
              'openai/toolInvocation/invoking': 'Opening ComicChat…',
              'openai/toolInvocation/invoked': 'ComicChat opened.',
            },
          },
          async ({ conversationId }) => {
            const { data: authData, error: authError } = await supabase.auth.getUser()
            if (authError || !authData.user) fail(authError || 'Authenticated user missing')

            const { data: profileRow, error: profileError } = await supabase
              .from('user')
              .select('id, username, email')
              .eq('id', authData.user.id)
              .maybeSingle()
            if (profileError) fail(profileError)

            const { data: conversationRows, error: conversationsError } = await supabase.rpc(
              'comic_list_direct_conversations'
            )
            if (conversationsError) fail(conversationsError)

            const [groupResult, invitationResult] = await Promise.all([
              supabase.rpc('comic_list_groups'),
              supabase.rpc('comic_list_group_invitations'),
            ])
            if (groupResult.error) fail(groupResult.error)
            if (invitationResult.error) fail(invitationResult.error)

            let messages: Record<string, unknown>[] = []
            if (conversationId) {
              const { data: messageRows, error: messagesError } = await supabase.rpc(
                'comic_read_conversation_messages',
                {
                  p_conversation_id: conversationId,
                  p_limit: 100,
                }
              )
              if (messagesError) fail(messagesError)
              messages = messageRows || []
            }

            const profile = {
              id: authData.user.id,
              ...(profileRow?.username ? { name: profileRow.username } : {}),
              ...(profileRow?.email || authData.user.email
                ? { email: profileRow?.email || authData.user.email }
                : {}),
              nickname: profileRow?.username || authData.user.email || 'ComicChat account',
            }

            return jsonResult({
              profile,
              conversations: conversationRows || [],
              groups: groupResult.data || [],
              invitations: invitationResult.data || [],
              selectedConversationId: conversationId || null,
              messages,
            })
          }
        )

        server.registerTool(
          'list_groups',
          {
            title: 'List ComicChat groups',
            description: "List only groups the authenticated account belongs to. Resolve the profile to choose the correct connected account.",
            inputSchema: {  },
            outputSchema: { groups: z.array(z.record(z.string(), z.unknown())) },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async () => {
            const { data, error } = await supabase.rpc('comic_list_groups')
            if (error) fail(error)
            return jsonResult({ groups: data || [] })
          }
        )

        server.registerTool(
          'list_group_invitations',
          {
            title: 'List ComicChat group invitations',
            description: "List pending closed-group invitations addressed to the authenticated account.",
            inputSchema: {  },
            outputSchema: { invitations: z.array(z.record(z.string(), z.unknown())) },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async () => {
            const { data, error } = await supabase.rpc('comic_list_group_invitations')
            if (error) fail(error)
            return jsonResult({ invitations: data || [] })
          }
        )

        server.registerTool(
          'list_group_members',
          {
            title: 'List ComicChat group members',
            description: "List members of a known group. Only current members can read; foreign and unknown group IDs fail uniformly.",
            inputSchema: { groupId: z.string().uuid() },
            outputSchema: { members: z.array(z.record(z.string(), z.unknown())) },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ groupId }) => {
            const { data, error } = await supabase.rpc('comic_list_group_members', { p_group_id: groupId })
            if (error) fail(error)
            return jsonResult({ members: data || [] })
          }
        )

        server.registerTool(
          'create_group',
          {
            title: 'Create ComicChat group',
            description: "Create a closed or public ordinary group after explicit user request. Public creation requires explicit acceptance of future message reuse in published comics.",
            inputSchema: { title: z.string().trim().min(3).max(80), visibility: z.enum(['closed', 'public']).default('closed'), acceptPublicReuse: z.boolean().default(false) },
            outputSchema: { groupId: z.string().uuid() },
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ title, visibility, acceptPublicReuse }) => {
            if (visibility === 'public' && !acceptPublicReuse) fail('public_group_terms_required')
            const { data, error } = await supabase.rpc('comic_create_group', { p_title: title, p_visibility: visibility })
            if (error) fail(error)
            return jsonResult({ groupId: data })
          }
        )

        server.registerTool(
          'invite_group_user',
          {
            title: 'Invite ComicChat group user',
            description: "Invite an exact user ID returned by find_users to a known closed group. Only the group owner can invite. Do not invent users or invite without the user's instruction.",
            inputSchema: { groupId: z.string().uuid(), userId: z.string().uuid() },
            outputSchema: { invited: z.boolean() },
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ groupId, userId }) => {
            const { data, error } = await supabase.rpc('comic_invite_group_user', { p_group_id: groupId, p_user_id: userId })
            if (error) fail(error)
            return jsonResult({ invited: data })
          }
        )

        server.registerTool(
          'join_group',
          {
            title: 'Join ComicChat group',
            description: "Accept an invitation to a closed group or join a known public group. Public join requires explicit consent to future message reuse in published comics. Never infer consent.",
            inputSchema: { groupId: z.string().uuid(), acceptPublicReuse: z.boolean().default(false) },
            outputSchema: { groupId: z.string().uuid() },
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ groupId, acceptPublicReuse }) => {
            const { data, error } = await supabase.rpc('comic_join_group', { p_group_id: groupId, p_accept_public_reuse: acceptPublicReuse })
            if (error) fail(error)
            return jsonResult({ groupId: data })
          }
        )

        server.registerTool(
          'leave_group',
          {
            title: 'Leave ComicChat group',
            description: "Leave a known group only when the user requests it; this removes current history access. Group owners must transfer ownership first.",
            inputSchema: { groupId: z.string().uuid() },
            outputSchema: { left: z.boolean() },
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ groupId }) => {
            const { data, error } = await supabase.rpc('comic_leave_group', { p_group_id: groupId })
            if (error) fail(error)
            return jsonResult({ left: data })
          }
        )

        server.registerTool(
          'comicchat_profile',
          {
            title: 'ComicChat profile',
            description:
              'Return the ComicChat profile represented by the authenticated credentials.',
            inputSchema: {},
            outputSchema: {
              id: z.string(),
              name: z.string().optional(),
              email: z.string().optional(),
              nickname: z.string().optional(),
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
            _meta: { 'openai/profile': true },
          },
          async () => {
            const { data: authData, error: authError } = await supabase.auth.getUser()
            if (authError || !authData.user) fail(authError || 'Authenticated user missing')

            const { data: profile, error: profileError } = await supabase
              .from('user')
              .select('id, username, email')
              .eq('id', authData.user.id)
              .maybeSingle()
            if (profileError) fail(profileError)

            const result = {
              id: authData.user.id,
              ...(profile?.username ? { name: profile.username } : {}),
              ...(profile?.email || authData.user.email
                ? { email: profile?.email || authData.user.email }
                : {}),
              nickname: profile?.username || authData.user.email || 'ComicChat account',
            }
            return jsonResult(result)
          }
        )

        server.registerTool(
          'list_conversations',
          {
            title: 'List ComicChat conversations',
            description:
              'List private direct conversations visible to the authenticated ComicChat user.',
            inputSchema: {
              limit: z.number().int().min(1).max(100).default(20),
            },
            outputSchema: {
              conversations: z.array(z.record(z.string(), z.unknown())),
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ limit }) => {
            const { data, error } = await supabase.rpc('comic_list_direct_conversations')
            if (error) fail(error)
            const conversations = (data || []).slice(0, limit)
            return jsonResult({ conversations })
          }
        )

        server.registerTool(
          'get_messages',
          {
            title: 'Read ComicChat messages',
            description:
              'Read recent messages through the explicit membership-checked conversation RPC. Foreign and unknown conversation IDs fail with the same authorization error.',
            inputSchema: {
              conversationId: z.string().uuid(),
              limit: z.number().int().min(1).max(100).default(30),
            },
            outputSchema: {
              messages: z.array(z.record(z.string(), z.unknown())),
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ conversationId, limit }) => {
            const { data, error } = await supabase.rpc(
              'comic_read_conversation_messages',
              {
                p_conversation_id: conversationId,
                p_limit: limit,
              }
            )
            if (error) fail(error)
            return jsonResult({ messages: data || [] })
          }
        )

        server.registerTool(
          'find_users',
          {
            title: 'Find ComicChat users',
            description:
              'Find ComicChat users by username before starting a direct conversation.',
            inputSchema: {
              query: z.string().trim().min(2).max(100),
            },
            outputSchema: {
              users: z.array(z.record(z.string(), z.unknown())),
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ query }) => {
            const { data, error } = await supabase.rpc('comic_search_users', {
              p_query: query,
            })
            if (error) fail(error)
            return jsonResult({ users: data || [] })
          }
        )

        server.registerTool(
          'open_direct_conversation',
          {
            title: 'Open ComicChat conversation',
            description:
              'Create or reuse a private direct conversation with an exact ComicChat user ID returned by find_users.',
            inputSchema: {
              partnerId: z.string().uuid(),
            },
            outputSchema: {
              conversationId: z.string().uuid(),
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ partnerId }) => {
            const { data, error } = await supabase.rpc('comic_ensure_direct_conversation', {
              partner_id: partnerId,
            })
            if (error) fail(error)
            return jsonResult({ conversationId: data })
          }
        )

        server.registerTool(
          'send_message',
          {
            title: 'Send ComicChat message',
            description:
              'Send exact text to an existing private ComicChat conversation. requestId is a stable UUID idempotency key; reuse it if the same send is retried.',
            inputSchema: {
              conversationId: z.string().uuid(),
              requestId: z.string().uuid(),
              text: z.string().min(1).max(4000),
            },
            outputSchema: {
              message: z.record(z.string(), z.unknown()),
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ conversationId, requestId, text }) => {
            const { data, error } = await supabase.rpc('comic_send_message', {
              p_conversation_id: conversationId,
              p_client_nonce: requestId,
              p_original_text: text,
            })
            if (error) fail(error)
            const message = Array.isArray(data) ? data[0] : data
            if (!message?.id) throw new Error('comic_send_message returned no message')
            return jsonResult({ message })
          }
        )



        server.registerTool(
          'list_public_snapshot_requests',
          {
            title: 'List ComicChat public-sharing snapshot requests',
            description:
              'List active snapshot-scoped sharing consent requests for one private conversation. This is consent state only; publication remains disabled.',
            inputSchema: {
              conversationId: z.string().uuid(),
            },
            outputSchema: {
              requests: z.array(z.record(z.string(), z.unknown())),
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ conversationId }) => {
            const { data, error } = await supabase.rpc(
              'comic_list_public_snapshot_requests',
              { p_conversation_id: conversationId }
            )
            if (error) fail(error)
            return jsonResult({ requests: data || [] })
          }
        )

        server.registerTool(
          'propose_public_snapshot',
          {
            title: 'Propose a ComicChat snapshot for future public sharing',
            description:
              'Create or reuse a sharing-consent request for one exact conversation snapshot through a known message ID. Creating the proposal records the authenticated proposer\'s consent, but publication remains disabled and the other participant must separately consent.',
            inputSchema: {
              conversationId: z.string().uuid(),
              throughMessageId: z.string().uuid(),
            },
            outputSchema: {
              requestId: z.string().uuid(),
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ conversationId, throughMessageId }) => {
            const { data, error } = await supabase.rpc(
              'comic_propose_public_snapshot',
              {
                p_conversation_id: conversationId,
                p_through_message_id: throughMessageId,
              }
            )
            if (error) fail(error)
            if (!data) throw new Error('comic_propose_public_snapshot returned no request')
            return jsonResult({ requestId: data })
          }
        )

        server.registerTool(
          'set_public_snapshot_consent',
          {
            title: 'Set my ComicChat snapshot-sharing consent',
            description:
              'Explicitly consent to or revoke consent from one existing snapshot request. This never publishes anything; publication remains disabled.',
            inputSchema: {
              requestId: z.string().uuid(),
              consented: z.boolean(),
            },
            outputSchema: {
              consented: z.boolean(),
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ requestId, consented }) => {
            const { data, error } = await supabase.rpc(
              'comic_set_public_snapshot_consent',
              {
                p_request_id: requestId,
                p_consented: consented,
              }
            )
            if (error) fail(error)
            return jsonResult({ consented: Boolean(data) })
          }
        )

        server.registerTool(
          'cancel_public_snapshot_request',
          {
            title: 'Cancel a ComicChat snapshot-sharing request',
            description:
              'Permanently cancel one active snapshot-sharing consent request as a conversation member. A new explicit proposal is required afterward; publication remains disabled.',
            inputSchema: {
              requestId: z.string().uuid(),
            },
            outputSchema: {
              cancelled: z.boolean(),
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ requestId }) => {
            const { data, error } = await supabase.rpc(
              'comic_cancel_public_snapshot_request',
              { p_request_id: requestId }
            )
            if (error) fail(error)
            return jsonResult({ cancelled: Boolean(data) })
          }
        )

        server.registerTool(
          'get_beta_safety_status',
          {
            title: 'Get ComicChat closed-beta safety status',
            description:
              'Read the authenticated ComicChat closed-beta safety disclosure. The current generation provider is mock; external generation, media storage, public publication, hard deletion and automated purge are disabled, and the retention duration is not defined.',
            inputSchema: {},
            outputSchema: {
              status: z.record(z.string(), z.unknown()),
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async () => {
            const { data, error } = await supabase.rpc('comic_get_beta_safety_status')
            if (error) fail(error)
            const status = Array.isArray(data) ? data[0] : data
            if (!status) throw new Error('comic_get_beta_safety_status returned no state')
            return jsonResult({ status })
          }
        )

        server.registerTool(
          'get_media_capabilities',
          {
            title: 'Get ComicChat media capabilities',
            description:
              'Read the current ComicChat media capability gate. Media storage and public media URLs are disabled; this tool does not upload, sign, publish, or fetch media.',
            inputSchema: {},
            outputSchema: {
              capabilities: z.record(z.string(), z.unknown()),
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async () => {
            const { data, error } = await supabase.rpc('comic_get_media_capabilities')
            if (error) fail(error)
            const capabilities = Array.isArray(data) ? data[0] : data
            if (!capabilities) throw new Error('comic_get_media_capabilities returned no state')
            return jsonResult({ capabilities })
          }
        )

        server.registerTool(
          'get_account_deletion_status',
          {
            title: 'Get ComicChat account deletion status',
            description:
              'Read the authenticated user\'s ComicChat deletion-request state. This does not change or delete anything.',
            inputSchema: {},
            outputSchema: {
              accountState: z.record(z.string(), z.unknown()),
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async () => {
            const { data, error } = await supabase.rpc('comic_get_my_account_state')
            if (error) fail(error)
            const accountState = Array.isArray(data) ? data[0] : data
            return jsonResult({ accountState: accountState || { status: 'active' } })
          }
        )

        server.registerTool(
          'request_account_deletion',
          {
            title: 'Request ComicChat account deletion',
            description:
              'Request deletion for the authenticated ComicChat account only when the user explicitly asks to do so. New chat interaction stops immediately, but shared history is retained and hard deletion is not enabled yet. The request can be cancelled.',
            inputSchema: {},
            outputSchema: {
              accountState: z.record(z.string(), z.unknown()),
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async () => {
            const { data, error } = await supabase.rpc('comic_request_account_deletion')
            if (error) fail(error)
            const accountState = Array.isArray(data) ? data[0] : data
            if (!accountState) throw new Error('comic_request_account_deletion returned no state')
            return jsonResult({ accountState })
          }
        )

        server.registerTool(
          'cancel_account_deletion',
          {
            title: 'Cancel ComicChat account deletion request',
            description:
              'Cancel the authenticated user\'s reversible ComicChat deletion request and restore new chat interaction.',
            inputSchema: {},
            outputSchema: {
              accountState: z.record(z.string(), z.unknown()),
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async () => {
            const { data, error } = await supabase.rpc('comic_cancel_account_deletion')
            if (error) fail(error)
            const accountState = Array.isArray(data) ? data[0] : data
            return jsonResult({ accountState: accountState || { status: 'active' } })
          }
        )

        server.registerTool(
          'export_my_data',
          {
            title: 'Export my ComicChat data',
            description:
              'Return the authenticated user\'s self-service ComicChat export. Use only when the user explicitly asks to export or inspect their own data because the result can contain private conversation history.',
            inputSchema: {},
            outputSchema: {
              export: z.record(z.string(), z.unknown()),
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async () => {
            const { data, error } = await supabase.rpc('comic_export_my_data')
            if (error) fail(error)
            if (!data || typeof data !== 'object') {
              throw new Error('comic_export_my_data returned no export')
            }
            return jsonResult({ export: data })
          }
        )

        server.registerTool(
          'list_blocked_users',
          {
            title: 'List blocked ComicChat users',
            description:
              'List ComicChat users blocked by the authenticated user. The database only exposes blocks owned by the caller.',
            inputSchema: {},
            outputSchema: {
              blockedUsers: z.array(z.record(z.string(), z.unknown())),
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async () => {
            const { data, error } = await supabase.rpc('comic_list_blocked_users')
            if (error) fail(error)
            return jsonResult({ blockedUsers: data || [] })
          }
        )

        server.registerTool(
          'block_user',
          {
            title: 'Block ComicChat user',
            description:
              'Block an exact ComicChat user ID. Existing history is preserved, but new search/open/send interactions between the two users are rejected until all relevant blocks are removed.',
            inputSchema: {
              userId: z.string().uuid(),
            },
            outputSchema: {
              blocked: z.boolean(),
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ userId }) => {
            const { data, error } = await supabase.rpc('comic_block_user', {
              p_user_id: userId,
            })
            if (error) fail(error)
            return jsonResult({ blocked: Boolean(data) })
          }
        )

        server.registerTool(
          'unblock_user',
          {
            title: 'Unblock ComicChat user',
            description:
              'Remove a block created by the authenticated user. Interaction resumes only if the other user has not independently blocked the caller.',
            inputSchema: {
              userId: z.string().uuid(),
            },
            outputSchema: {
              unblocked: z.boolean(),
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ userId }) => {
            const { data, error } = await supabase.rpc('comic_unblock_user', {
              p_user_id: userId,
            })
            if (error) fail(error)
            return jsonResult({ unblocked: Boolean(data) })
          }
        )


        server.registerTool(
          'list_my_reports',
          {
            title: 'List my ComicChat reports',
            description:
              'List abuse reports submitted by the authenticated ComicChat user. Reports submitted by other users are not exposed.',
            inputSchema: {},
            outputSchema: {
              reports: z.array(z.record(z.string(), z.unknown())),
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async () => {
            const { data, error } = await supabase.rpc('comic_list_my_reports')
            if (error) fail(error)
            return jsonResult({ reports: data || [] })
          }
        )

        server.registerTool(
          'report_message',
          {
            title: 'Report ComicChat message',
            description:
              'Submit an abuse report for one exact incoming ComicChat message. Use only when the user explicitly asks to report that specific message. requestId is a stable UUID idempotency key.',
            inputSchema: {
              messageId: z.string().uuid(),
              requestId: z.string().uuid(),
              reason: z.enum([
                'spam',
                'harassment',
                'threats',
                'sexual_content',
                'hate',
                'self_harm',
                'other',
              ]),
              details: z.string().trim().max(1000).optional(),
            },
            outputSchema: {
              report: z.record(z.string(), z.unknown()),
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: false,
            },
            securitySchemes: oauth,
          },
          async ({ messageId, requestId, reason, details }) => {
            const { data, error } = await supabase.rpc('comic_report_message', {
              p_message_id: messageId,
              p_client_nonce: requestId,
              p_reason: reason,
              p_details: details || null,
            })
            if (error) fail(error)
            const report = Array.isArray(data) ? data[0] : data
            if (!report?.id) throw new Error('comic_report_message returned no report')
            return jsonResult({ report })
          }
        )

        return server
      })

      return handler.fetch(req)
    }
  )
)
