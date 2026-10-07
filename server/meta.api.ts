export const META_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish';
export const metaVersion = () => process.env.FACEBOOK_GRAPH_API_VERSION || 'v25.0';
export async function metaRequest(path: string, token: string, params: Record<string,string> = {}, method = 'GET'): Promise<any> {
  const url = new URL('https://graph.facebook.com/' + metaVersion() + '/' + path);
  const options: RequestInit = { method, headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) };
  if (method === 'GET') url.search = new URLSearchParams(params).toString();
  else options.body = new URLSearchParams(params);
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('Meta request failed (code ' + (data.error?.code || response.status) + '). Check app roles in development mode, granted permissions, and Page access.');
  return data;
}
export async function metaPages(token: string): Promise<any[]> {
  const pages: any[] = [];
  let after = '';
  do {
    const data = await metaRequest('me/accounts', token, { fields: 'id,name,access_token,tasks,instagram_business_account{id,username}', limit: '100', ...(after ? {after} : {}) });
    pages.push(...(data.data || []));
    after = data.paging?.next ? data.paging?.cursors?.after : '';
  } while (after);
  if (!pages.length) throw new Error('No managed Facebook Page found. Grant pages_show_list, select your Page during login, and use a Facebook account with Page access and an app admin/developer/tester role in development mode.');
  return pages;
}
