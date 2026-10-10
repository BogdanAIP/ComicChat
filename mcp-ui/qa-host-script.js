const fixture = { profile: { id: '06642244-7e05-4567-8763-dae5c939b565', name: 'Alpha', email: 'gpt-alpha-20261010@comicchat.test' }, conversations: [], groups: [], invitations: [], messages: [], selectedConversationId: null };
window.qaCalls = [];
window.qaGroup = null;
window.addEventListener('message', event => {
 const q = event.data; if (!q || q.jsonrpc !== '2.0') return;
 const reply = result => event.source.postMessage({ jsonrpc: '2.0', id: q.id, result }, '*');
 if (q.method === 'ui/initialize') reply({ protocolVersion: q.params.protocolVersion, hostInfo: { name: 'ComicChat QA host', version: '1' }, hostCapabilities: { serverTools: {} }, hostContext: { theme: 'light', locale: 'en', displayMode: 'inline' } });
 else if (q.method === 'ui/notifications/initialized') event.source.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [], structuredContent: fixture } }, '*');
 else if (q.method === 'tools/call') {
  window.qaCalls.push(q.params);
  const req = q.params.arguments?.request, op = req?.operation, a = req?.args;
  let data = [];
  if (op === 'comic_get_my_account_state') data = [{ status: 'active', hard_delete_enabled: false }];
  if (op === 'comic_get_beta_safety_status') data = [{ external_generation_enabled: false, media_storage_enabled: false }];
  if (op === 'comic_search_users') data = [{ user_id: 'c31127c4-f3f7-41dd-a1a1-ff93d5d7ef25', username: 'Bravo' }];
  if (op === 'comic_create_group') { window.qaGroup = { conversation_id: '00000000-0000-4000-a000-000000000036', title: a.p_title, visibility: a.p_visibility, role: 'owner', member_count: 1 }; data = window.qaGroup.conversation_id; }
  if (op === 'comic_list_groups') data = window.qaGroup ? [window.qaGroup] : [];
  if (op === 'comic_list_group_members') data = [{ user_id: fixture.profile.id, username: 'Alpha', role: 'owner' }];
  if (op === 'comic_send_message') data = [{ id: '00000000-0000-4000-a000-000000000037', conversation_id: a.p_conversation_id, client_nonce: a.p_client_nonce, original_text: a.p_original_text, sender_id: fixture.profile.id, created_at: new Date().toISOString(), status: 'queued' }];
  reply({ content: [], structuredContent: { data } });
 } else if (q.id) reply({});
});
window.qaSwitchAccount = () => document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [], structuredContent: { ...fixture, profile: { ...fixture.profile, id: 'c31127c4-f3f7-41dd-a1a1-ff93d5d7ef25', name: 'Bravo', email: 'gpt-bravo-20261010@comicchat.test' } } } }, '*');
