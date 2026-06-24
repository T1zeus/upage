import type { ComponentBlock, ComponentCategoryMeta } from './types';

export const componentCategories: ComponentCategoryMeta[] = [
  { key: 'layout', label: '布局' },
  { key: 'basic', label: '基础' },
  { key: 'content', label: '内容' },
];

/**
 * 内置静态组件库。html 根元素不写死 id，放置到画布时再注入唯一 id。
 * 画布 iframe 已加载 Tailwind，这里直接使用 Tailwind class。
 */
export const componentLibrary: ComponentBlock[] = [
  {
    id: 'layout-container',
    name: '容器',
    category: 'layout',
    icon: '▭',
    html: '<div class="flex gap-4 p-6"></div>',
  },
  {
    id: 'layout-grid-2',
    name: '两列栅格',
    category: 'layout',
    icon: '▥',
    html: '<div class="grid grid-cols-2 gap-6 p-6"></div>',
  },
  {
    id: 'basic-button',
    name: '按钮',
    category: 'basic',
    icon: '⬚',
    html: '<button class="px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700">按钮</button>',
  },
  {
    id: 'basic-heading',
    name: '标题',
    category: 'basic',
    icon: 'H',
    html: '<h2 class="text-2xl font-bold text-gray-900">标题文本</h2>',
  },
  {
    id: 'content-card',
    name: '卡片',
    category: 'content',
    icon: '🗂',
    html: '<div class="rounded-lg shadow p-4 bg-white max-w-sm"><img src="https://placehold.co/400x200" alt="封面" class="w-full rounded mb-3"/><h3 class="text-lg font-semibold mb-1">卡片标题</h3><p class="text-gray-600 text-sm">这里是卡片描述内容。</p></div>',
  },
];

export type { ComponentBlock, ComponentCategory, ComponentCategoryMeta } from './types';
