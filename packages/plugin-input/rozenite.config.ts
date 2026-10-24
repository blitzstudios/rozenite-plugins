import type { RozeniteConfig } from '@rozenite/vite-plugin';

export default {
  panels: [{ name: 'Input', source: './src/panel/input_panel.tsx' }],
  integrations: ['react-native'],
} satisfies RozeniteConfig;
