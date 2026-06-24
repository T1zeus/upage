import { atom } from 'nanostores';

/**
 * 跨文档（外层「属性」面板 ↔ iframe 内 overlay）共享的选中元素状态。
 *
 * 选中态原本只存在于 iframe 内 PageRender/EditorOverlay 的局部 state，外层左侧面板
 * （另一棵 React 树）拿不到。这里用 nanostore 作为唯一中介：当前可见页的 overlay 发布
 * 选中元素及其 iframe window 与一组编辑回调，回调闭包捕获了该 overlay 的撤销/保存链路。
 *
 * 编辑拆成三步以避免「每次按键都入栈+保存」导致的卡顿与数据回跳：
 * - beginEdit：一次编辑开始时记录一次撤销快照（仅首次改动调用）。
 * - applyStyle：输入过程中只改 DOM + 重渲染 overlay，做实时预览，不入栈不保存。
 * - commitEdit：失焦/离散选择时才持久化保存。
 */
export interface SelectionHandlers {
  beginEdit: () => void;
  applyStyle: (mutate: (el: HTMLElement) => void) => void;
  commitEdit: () => void;
}

export interface ElementSelection extends Partial<SelectionHandlers> {
  element: HTMLElement | null;
  // iframe window，用于 getComputedStyle 解析 Tailwind 类的计算值。
  win: Window | null;
  // 外部（拖拽/撤销等）变更元素后自增，强制面板重新读取当前样式。
  nonce: number;
}

const EMPTY_SELECTION: ElementSelection = { element: null, win: null, nonce: 0 };

export const elementSelectionStore = atom<ElementSelection>(EMPTY_SELECTION);

export function publishElementSelection(element: HTMLElement, win: Window, handlers: SelectionHandlers) {
  const prev = elementSelectionStore.get();
  elementSelectionStore.set({ element, win, ...handlers, nonce: prev.nonce + 1 });
}

export function clearElementSelection() {
  const prev = elementSelectionStore.get();
  if (prev.element === null) {
    return;
  }
  elementSelectionStore.set({ ...EMPTY_SELECTION, nonce: prev.nonce + 1 });
}

// 元素被外部就地修改后，仅自增 nonce 触发面板重读，不改变选中目标。
export function bumpElementSelectionNonce() {
  const prev = elementSelectionStore.get();
  if (!prev.element) {
    return;
  }
  elementSelectionStore.set({ ...prev, nonce: prev.nonce + 1 });
}
