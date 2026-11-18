import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import QRCodeModal from '../../src/components/modals/QRCodeModal.vue';
import QuickImportModal from '../../src/components/modals/QuickImportModal.vue';
import { createI18n } from '../../src/i18n/index.js';
import { shadowrocketQrPayload } from '../../src/utils/shadowrocket-links.js';

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn().mockResolvedValue(undefined) } }));
const modalStub = {
  props: ['show'],
  template: '<div v-if="show"><slot name="title" /><slot name="body" /></div>',
};
const base = 'https://example.com/private-token/ios';
const global = () => ({
  plugins: [createPinia(), createI18n({ initialLocale: 'zh-CN' })],
  stubs: { Modal: modalStub },
});

describe('Shadowrocket import entry points', () => {
  it('preserves the generic QR until a client action is selected', async () => {
    const wrapper = mount(QRCodeModal, {
      props: { show: true, url: base, title: 'iOS-Shadowrocket', subscription: true },
      global: global(),
    });
    await flushPromises();
    expect(QRCode.toCanvas).toHaveBeenLastCalledWith(expect.anything(), base, expect.anything());
    expect(wrapper.text()).not.toContain('private-token');
    await wrapper.get('select').setValue('shadowrocket-config');
    await flushPromises();
    const payload = QRCode.toCanvas.mock.lastCall[1];
    expect(payload.startsWith('shadowrocket://config/add/')).toBe(true);
    const url = new URL(decodeURIComponent(payload.slice('shadowrocket://config/add/'.length)));
    expect(url.origin + url.pathname).toBe(base + '/iOS-Shadowrocket.conf');
    expect(url.searchParams.get('target')).toBe('shadowrocket');
    expect(url.searchParams.get('client')).toBe('shadowrocket');
    await wrapper.get('select').setValue('shadowrocket-nodes');
    await flushPromises();
    const [encodedNodes, params] = QRCode.toCanvas.mock.lastCall[1]
      .slice('shadowrocket://add/sub://'.length)
      .split('?');
    const nodes = new URL(atob(encodedNodes));
    expect(nodes.origin + nodes.pathname).toBe(base + '/iOS-Shadowrocket-nodes');
    expect(new URLSearchParams(params).get('remark')).toBe('iOS-Shadowrocket 节点');
    expect(nodes.searchParams.get('target')).toBe('base64');
    expect(nodes.searchParams.has('client')).toBe(false);
    await wrapper.setProps({ show: false });
    await wrapper.setProps({ show: true, url: base + '-other' });
    await flushPromises();
    expect(wrapper.get('select').element.value).toBe('universal');
    expect(QRCode.toCanvas.mock.lastCall[1]).toBe(base + '-other');
  });

  it('keeps non-profile QR codes unchanged without client controls', async () => {
    const wrapper = mount(QRCodeModal, {
      props: { show: true, url: 'vless://sanitized-node' },
      global: global(),
    });
    await flushPromises();
    expect(wrapper.find('select').exists()).toBe(false);
    expect(QRCode.toCanvas.mock.lastCall[1]).toBe('vless://sanitized-node');
  });

  it('keeps full configuration visible even when the configurable client list omits Shadowrocket', () => {
    const wrapper = mount(QuickImportModal, {
      props: {
        show: true,
        profile: { id: 'ios' },
        profileToken: 'share',
        clients: [{ id: 'loon', name: 'Loon' }],
      },
      global: global(),
    });
    const url = new URL(wrapper.get('input').element.value);
    expect(url.pathname).toBe('/share/ios');
    expect(url.searchParams.get('client')).toBe('shadowrocket');
    expect(wrapper.text()).toContain('复制完整配置链接');
  });

  it('removes incompatible node-only flags and Windows client parameters from configuration actions', () => {
    const payload = shadowrocketQrPayload(
      base + '?target=base64&client=windows-mihomo&list=true',
      'shadowrocket-config'
    );
    const url = new URL(decodeURIComponent(payload.slice('shadowrocket://config/add/'.length)));
    expect(url.searchParams.get('target')).toBe('shadowrocket');
    expect(url.searchParams.get('client')).toBe('shadowrocket');
    expect(url.searchParams.has('list')).toBe(false);
  });
});
