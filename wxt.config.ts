import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';

export default defineConfig({
  vite: () => ({ plugins: [react()] }),
  manifest: {
    name: 'Dynamics Toolkit',
    description: 'Developer and support tools for Microsoft Dynamics 365.',
    permissions: ['storage', 'activeTab', 'scripting', 'tabs', 'sidePanel'],
    host_permissions: ['https://*.dynamics.com/*'],
    action: { default_title: 'Dynamics Toolkit' },
    side_panel: { default_path: 'popup.html' },
    commands: { 'open-command-palette': { suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' }, description: 'Open command palette' } }
  }
});
