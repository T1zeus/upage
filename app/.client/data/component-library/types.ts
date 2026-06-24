export type ComponentCategory = 'layout' | 'basic' | 'content';

export interface ComponentBlock {
  // 组件唯一标识（仅用于面板渲染与拖拽识别，非注入到画布的 DOM id）
  id: string;
  // 组件显示名
  name: string;
  // 所属分类
  category: ComponentCategory;
  // 面板项图标（简单字形/emoji，直接作为文本渲染，避免依赖图标集构建）
  icon: string;
  // 注入画布的 HTML 片段。根元素不写死 id，放置时再注入唯一 id。
  html: string;
}

export interface ComponentCategoryMeta {
  key: ComponentCategory;
  label: string;
}
