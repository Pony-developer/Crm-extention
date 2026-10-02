import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';

export default defineConfig({
  vite: () => ({ plugins: [react()] }),
  manifest: {
    name: 'Dynamics Toolkit',
    description: 'Developer and support tools for Microsoft Dynamics 365.',
    // unlimitedStorage lifts the 10 MB storage.local quota that recorder screenshots would exhaust.
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'tabs', 'sidePanel'],
    host_permissions: ['https://*.dynamics.com/*'],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: {
      default_title: 'Dynamics Toolkit',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' }
    },
    side_panel: { default_path: 'popup.html' },
    commands: { 'open-command-palette': { suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' }, description: 'Open command palette' } }
  }
});
