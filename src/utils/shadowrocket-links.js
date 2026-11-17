export function shadowrocketConfigUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set('target', 'clash');
  url.searchParams.set('client', 'shadowrocket');
  url.searchParams.delete('list');
  return url.toString();
}

export function shadowrocketNodesUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set('target', 'base64');
  url.searchParams.delete('client');
  url.searchParams.delete('list');
  return url.toString();
}

// Configuration and node subscription imports use different Shadowrocket actions.
// https://github.com/LOWERTOP/Shadowrocket#url-schemes
export function shadowrocketQrPayload(baseUrl, mode) {
  if (mode === 'shadowrocket-config') {
    return `shadowrocket://config/add/${encodeURIComponent(shadowrocketConfigUrl(baseUrl))}`;
  }
  if (mode === 'shadowrocket-nodes') {
    const bytes = new TextEncoder().encode(shadowrocketNodesUrl(baseUrl));
    const encoded = btoa(String.fromCharCode(...bytes));
    return `shadowrocket://add/sub://${encoded}`;
  }
  return baseUrl;
}
