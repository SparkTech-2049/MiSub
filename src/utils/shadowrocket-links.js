function namedUrl(baseUrl, profileName, suffix) {
  const url = new URL(baseUrl);
  if (profileName) {
    const name = String(profileName)
      .replace(/[^\p{L}\p{N}._-]+/gu, '-')
      .replace(/^[.-]+|[.-]+$/g, '');
    const file = (name.replace(/\.conf$/i, '') || 'MiSub').slice(0, 64) + suffix;
    url.pathname = url.pathname.replace(/\/$/, '') + '/' + encodeURIComponent(file);
  }
  return url;
}

export function shadowrocketConfigUrl(baseUrl, profileName) {
  const url = namedUrl(baseUrl, profileName, '.conf');
  url.searchParams.set('target', 'shadowrocket');
  url.searchParams.set('client', 'shadowrocket');
  url.searchParams.delete('list');
  return url.toString();
}

export function shadowrocketNodesUrl(baseUrl, profileName) {
  const url = namedUrl(baseUrl, profileName, '-nodes');
  url.searchParams.set('target', 'base64');
  url.searchParams.set('node-order', 'manual-region');
  url.searchParams.delete('client');
  url.searchParams.delete('list');
  return url.toString();
}

// Configuration and node subscription imports use different Shadowrocket actions.
// https://github.com/LOWERTOP/Shadowrocket#url-schemes
export function shadowrocketQrPayload(baseUrl, mode, profileName) {
  if (mode === 'shadowrocket-config') {
    return `shadowrocket://config/add/${encodeURIComponent(shadowrocketConfigUrl(baseUrl, profileName))}`;
  }
  if (mode === 'shadowrocket-nodes') {
    const bytes = new TextEncoder().encode(shadowrocketNodesUrl(baseUrl, profileName));
    const encoded = btoa(String.fromCharCode(...bytes));
    return (
      `shadowrocket://add/sub://${encoded}` +
      (profileName ? `?remark=${encodeURIComponent(`${profileName} 节点`)}` : '')
    );
  }
  return baseUrl;
}
