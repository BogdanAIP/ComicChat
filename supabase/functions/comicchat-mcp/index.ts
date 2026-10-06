// ComicChat PR-08: authenticated MCP boundary for ChatGPT/Codex.
// Private data stays behind Supabase OAuth 2.1 + existing RLS/RPC policies.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0'
import { pipeline } from 'npm:@supabase/middleware@^1.0.0'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@^1.6.0'
import { z } from 'npm:zod@^4.3.6'

const oauth = [{ type: 'oauth2' as const, scopes: ['openid', 'email', 'profile'] }]

function jsonResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  }
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
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
          { name: 'comicchat', version: '0.1.0' },
          {
            instructions:
              'ComicChat is a private comic-first messenger. Resolve the authenticated profile before account-sensitive work. List or find a conversation before reading or sending. Never invent conversation IDs, user IDs, message IDs, or text.',
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
              'Read recent messages in one private conversation. Existing row-level security limits access to members.',
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
            const { data, error } = await supabase
              .from('comic_message')
              .select('id, conversation_id, sender_id, original_text, status, created_at, updated_at')
              .eq('conversation_id', conversationId)
              .order('created_at', { ascending: false })
              .order('id', { ascending: false })
              .limit(limit)
            if (error) fail(error)
            return jsonResult({ messages: (data || []).reverse() })
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

        return server
      })

      return handler.fetch(req)
    }
  )
)
