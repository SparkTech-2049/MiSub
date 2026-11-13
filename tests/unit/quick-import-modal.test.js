import { beforeEach, describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import QuickImportModal from '../../src/components/modals/QuickImportModal.vue';
import { createI18n } from '../../src/i18n/index.js';

const globalOptions = () => ({
    plugins: [createI18n({ initialLocale: 'en-US' })],
    stubs: {
        Teleport: true,
    },
});

describe('QuickImportModal', () => {
    it('separates Shadowrocket full configuration from the legacy node import', async () => {
        delete window.location;
        window.location = { href: 'https://misub.example/public', origin: 'https://misub.example' };
        const writeText = vi.fn().mockResolvedValue();
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        const wrapper = mount(QuickImportModal, {
            props: {
                show: true,
                profile: { id: 'p1', name: 'Test' },
                clients: [{ id: 'shadowrocket', name: 'Shadowrocket', platforms: ['ios'] }],
            },
            global: globalOptions(),
        });
        expect(wrapper.find('input[readonly]').element.value).toBe(
            'https://misub.example/profiles/p1?target=clash&client=shadowrocket'
        );
        const copyButton = wrapper
            .findAll('button')
            .find((button) => button.text() === 'Copy full configuration link');
        await copyButton.trigger('click');
        expect(writeText).toHaveBeenCalledWith(
            'https://misub.example/profiles/p1?target=clash&client=shadowrocket'
        );
        await wrapper.find('button.group').trigger('click');
        expect(window.location.href).toContain('shadowrocket://add/sub://');
        expect(wrapper.text()).toContain('Nodes only');
    });
    beforeEach(() => {
        window.history.replaceState({}, '', '/public');
    });

    it('renders through shared Modal and emits close on visibility update', async () => {
        const wrapper = mount(QuickImportModal, {
            props: {
                show: true,
                profile: { id: 'p1', name: 'Demo' },
                clients: [],
                profileToken: 'profiles',
            },
            global: globalOptions(),
        });

        expect(wrapper.text()).toContain('Choose client import');
        await wrapper.findComponent({ name: 'Modal' }).vm.$emit('update:show', false);

        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('uses mihomo deep link and an explicit Clash target for Clash-Party one-click import', async () => {
        delete window.location;
        window.location = { href: 'https://misub.example/public', origin: 'https://misub.example' };

        const wrapper = mount(QuickImportModal, {
            props: {
                show: true,
                profile: { id: 'p1', customId: '!luckyss', name: 'Lucky SS' },
                clients: [{ id: 'clash-party', name: 'Clash Party', platforms: ['windows'] }],
                profileToken: '',
            },
            global: globalOptions(),
        });

        await wrapper.find('button.group').trigger('click');

        const expectedUrl = encodeURIComponent(
            'https://misub.example/profiles/!luckyss?target=clash'
        );
        expect(window.location.href).toBe(
            `mihomo://install-config?url=${expectedUrl}&name=Lucky%20SS`
        );
    });
});
