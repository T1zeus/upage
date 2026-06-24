import { atom } from 'nanostores';

/**
 * 跨文档（外层面板 ↔ iframe 内 overlay）共享的组件拖放状态。
 *
 * 面板在外层主文档，画布与 EditorOverlay 在 iframe 内的 shadow DOM。两者属于不同的
 * React 子树，无法直接用 props/setState 通信，因此用 nanostore 作为唯一中介：
 * 面板负责整段指针手势（写入 html、实时 pointer、最终提交信号），
 * EditorOverlay 订阅 store：拖拽中据 pointer 画指示线，收到 'drop' 时执行插入。
 */
export type ComponentDragPhase = 'idle' | 'dragging' | 'drop';

export interface ComponentDragState {
  phase: ComponentDragPhase;
  // 正在拖拽的组件 HTML 片段；idle 时为 null。
  activeBlockHtml: string | null;
  // 光标在「外层主文档」视口中的坐标。EditorOverlay 内部用 iframe 元素的 rect 换算到 iframe 坐标。
  pointer: { x: number; y: number } | null;
}

const IDLE_STATE: ComponentDragState = { phase: 'idle', activeBlockHtml: null, pointer: null };

export const componentDragStore = atom<ComponentDragState>(IDLE_STATE);

export function startComponentDrag(html: string, pointer: { x: number; y: number }) {
  componentDragStore.set({ phase: 'dragging', activeBlockHtml: html, pointer });
}

export function updateComponentDragPointer(pointer: { x: number; y: number }) {
  const state = componentDragStore.get();
  if (state.phase !== 'dragging') {
    return;
  }
  componentDragStore.set({ ...state, pointer });
}

// 指针抬起：保留 html 与最终 pointer，将相位切到 'drop'，由 overlay 执行插入后清理。
export function commitComponentDrag(pointer: { x: number; y: number }) {
  const state = componentDragStore.get();
  if (state.phase !== 'dragging' || !state.activeBlockHtml) {
    componentDragStore.set(IDLE_STATE);
    return;
  }
  componentDragStore.set({ ...state, phase: 'drop', pointer });
}

export function endComponentDrag() {
  componentDragStore.set(IDLE_STATE);
}
