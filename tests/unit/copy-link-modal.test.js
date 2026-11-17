import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CopyLinkModal from '../../src/components/modals/CopyLinkModal.vue';
import { createI18n } from '../../src/i18n/index.js';

const modalStub = {
    props: ['show'],
    template: '<div v-if="show"><slot name="title" /><slot name="body" /></div>',
};

describe('CopyLinkModal', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('offers separate Shadowrocket configuration and node links in the dashboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        const wrapper = mount(CopyLinkModal, {
            props: { show: true, token: 'share-token', profile: { id: 'p1' } },
            global: {
                plugins: [createPinia(), createI18n({ initialLocale: 'zh-CN' })],
                stubs: { Modal: modalStub },
            },
        });
        const items = wrapper.findAll('.cursor-pointer');
        const full = items.find(
            (item) => item.text().includes('Shadowrocket') && item.text().includes('完整配置')
        );
        const nodes = items.find(
            (item) => item.text().includes('Shadowrocket') && item.text().includes('仅节点')
        );
        expect(full, 'Missing full configuration entry in CopyLinkModal').toBeTruthy();
        expect(nodes, 'Missing separately labelled node subscription').toBeTruthy();
        await full.trigger('click');
        expect(writeText).toHaveBeenLastCalledWith(
            `${window.location.origin}/share-token/p1?target=clash&client=shadowrocket`
        );
        expect(full.text()).toContain('配置 → +');
        await nodes.trigger('click');
        expect(writeText).toHaveBeenLastCalledWith(
            `${window.location.origin}/share-token/p1?target=base64`
        );
    });

    it('copies a native sing-box link instead of a base64 link', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        const wrapper = mount(CopyLinkModal, {
            props: {
                show: true,
                token: 'share-token',
                profile: { id: 'p1', customId: 'daily', name: '日常使用' },
            },
            global: {
                plugins: [createPinia()],
                stubs: { Modal: modalStub },
            },
        });

        const singBoxItem = wrapper
            .findAll('.cursor-pointer')
            .find((item) => item.text().includes('Sing-Box'));
        expect(singBoxItem).toBeTruthy();
        await singBoxItem.trigger('click');

        expect(writeText).toHaveBeenCalledWith(
            `${window.location.origin}/share-token/daily?singbox`
        );
        expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('?base64'));
    });
});
