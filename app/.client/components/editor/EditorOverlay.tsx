import {
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import { useStore } from '@nanostores/react';
import React, { useEffect, useReducer, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useFrame } from 'react-frame-component';
import { componentDragStore, endComponentDrag } from '~/.client/stores/component-drag';
import { clearElementSelection, publishElementSelection } from '~/.client/stores/element-selection';
import { generateCompactUUID } from '~/utils/uuid';
import { EditDialog } from './EditDialog';

export interface EditorOverlayProps {
  selectedElement: HTMLElement | null;
  hoveredElement: HTMLElement | null;
  setHoveredElement: (element: HTMLElement | null) => void;
  setSelectedElement: (element: HTMLElement | null) => void;
  onRequestSave?: () => void;
  // 是否为当前可见页：多页同时挂载各自的 overlay 并共享拖放 store，
  // 仅当前页 overlay 处理放置，避免隐藏页（iframe rect 为 0）抢先清空 store。
  active?: boolean;
}

function getTargetElement(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof target !== 'object') {
    return null;
  }

  const targetNode = target as Node;
  if (targetNode.nodeType === Node.ELEMENT_NODE) {
    return targetNode as HTMLElement;
  }

  if (targetNode.nodeType === Node.TEXT_NODE) {
    return targetNode.parentElement;
  }

  return null;
}

function isOverlayTarget(target: HTMLElement | null, shadowRoot: ShadowRoot | null) {
  if (!target) {
    return false;
  }

  if (target.id === 'editor-overlay' || target.closest('#editor-overlay')) {
    return true;
  }

  if (!shadowRoot) {
    return false;
  }

  return target.getRootNode() === shadowRoot;
}

// 指示线矩形：横向拖放时为横线（width=容器宽,height=3），纵向（左右）拖放时为竖线（width=3,height=容器高）。
export type IndicatorRect = { top: number; left: number; width: number; height: number };
export type DropTarget = {
  dropRef: Element | null;
  indicatorRect: IndicatorRect;
};
// 拖放命中轴向：'y' 上下排列（block/column），'x' 左右排列（flex-row）。
export type DropAxis = 'x' | 'y';
// 拖放命中模式：在轴向基础上增加 'grid'——网格/换行场景需按二维就近命中。
export type DropMode = DropAxis | 'grid';

// 可作为放置目标的容器型标签。命中行内/叶子元素时回退到最近的此类祖先。
const CONTAINER_TAGS = new Set([
  'DIV',
  'SECTION',
  'MAIN',
  'UL',
  'OL',
  'NAV',
  'ARTICLE',
  'ASIDE',
  'FORM',
  'HEADER',
  'FOOTER',
  'FIGURE',
]);

/**
 * 在容器内按光标坐标命中插入位置。`coord` 是沿轴坐标：axis='y' 传 clientY、axis='x' 传 clientX。
 * 返回插入参照节点 dropRef（insertBefore 第二参，null 表示追加末尾）与指示线矩形
 * （iframe 视口坐标，与 overlay-container 锚点一致）。纯函数，便于单测。
 */
export function computeDropTarget(
  parentEl: Element,
  coord: number,
  excludeEl: Element | null = null,
  axis: DropAxis = 'y',
): DropTarget {
  const siblings = (Array.from(parentEl.children) as HTMLElement[]).filter(
    (child) => child.id !== 'editor-overlay' && child !== excludeEl,
  );
  let dropRef: Element | null = null;
  for (const sib of siblings) {
    const rect = sib.getBoundingClientRect();
    // 'y' 比较垂直中线，'x' 比较水平中线
    const mid = axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    if (coord < mid) {
      dropRef = sib;
      break;
    }
  }
  const parentRect = parentEl.getBoundingClientRect();

  if (axis === 'x') {
    // 竖线：落在 dropRef 左缘 / 末尾兄弟右缘 / 空容器左缘
    let left: number;
    if (dropRef) {
      left = dropRef.getBoundingClientRect().left;
    } else if (siblings.length > 0) {
      left = siblings[siblings.length - 1].getBoundingClientRect().right;
    } else {
      left = parentRect.left;
    }
    return { dropRef, indicatorRect: { top: parentRect.top, left: left - 1.5, width: 3, height: parentRect.height } };
  }

  // 横线：落在 dropRef 上缘 / 末尾兄弟下缘 / 空容器上缘
  let top: number;
  if (dropRef) {
    top = dropRef.getBoundingClientRect().top;
  } else if (siblings.length > 0) {
    top = siblings[siblings.length - 1].getBoundingClientRect().bottom;
  } else {
    top = parentRect.top;
  }
  return { dropRef, indicatorRect: { top: top - 1.5, left: parentRect.left, width: parentRect.width, height: 3 } };
}

/**
 * 网格/换行容器（grid、flex-wrap）的二维命中：先按光标到各子项矩形的距离取最近子项，
 * 再以该子项水平中线判定插到它之前/之后，dropRef 取「之后」时为下一个兄弟。
 * 指示线为竖线，贴合命中子项的左缘或右缘、与该子项等高。纯函数，便于单测。
 */
export function computeGridDropTarget(
  parentEl: Element,
  x: number,
  y: number,
  excludeEl: Element | null = null,
): DropTarget {
  const siblings = (Array.from(parentEl.children) as HTMLElement[]).filter(
    (child) => child.id !== 'editor-overlay' && child !== excludeEl,
  );
  const parentRect = parentEl.getBoundingClientRect();
  if (siblings.length === 0) {
    return {
      dropRef: null,
      indicatorRect: { top: parentRect.top, left: parentRect.left - 1.5, width: 3, height: parentRect.height },
    };
  }

  // 取光标到子项矩形的最近子项（矩形外用钳制点距离，矩形内距离为 0）。
  let nearestIdx = 0;
  let nearestRect = siblings[0].getBoundingClientRect();
  let minDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < siblings.length; i++) {
    const r = siblings[i].getBoundingClientRect();
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      nearestIdx = i;
      nearestRect = r;
    }
  }

  // 水平中线左侧 → 插到 nearest 之前；右侧 → 插到下一个过滤后兄弟之前（末尾则追加）。
  const before = x < nearestRect.left + nearestRect.width / 2;
  const dropRef = before ? siblings[nearestIdx] : (siblings[nearestIdx + 1] ?? null);
  const edge = before ? nearestRect.left : nearestRect.right;
  return {
    dropRef,
    indicatorRect: { top: nearestRect.top, left: edge - 1.5, width: 3, height: nearestRect.height },
  };
}

// 从命中元素向上找到最近的容器型元素；找不到则回退到内容根。
function findDropContainer(start: HTMLElement, rootEl: HTMLElement): HTMLElement {
  let el: HTMLElement | null = start;
  while (el && el !== rootEl.parentElement) {
    if (el === rootEl) {
      return rootEl;
    }
    if (!el.closest('#editor-overlay') && CONTAINER_TAGS.has(el.tagName)) {
      return el;
    }
    el = el.parentElement;
  }
  return rootEl;
}

// 据容器计算样式判断子元素排列模式：grid/inline-grid 为 'grid'（二维就近）；
// flex-row（且换行 nowrap）为 'x'（左右）；flex-wrap 也回退 'grid'；其余为 'y'（上下）。
function detectDropMode(container: Element, win: Window): DropMode {
  const cs = win.getComputedStyle(container);
  if (cs.display === 'grid' || cs.display === 'inline-grid') {
    return 'grid';
  }
  if (cs.display === 'flex' || cs.display === 'inline-flex') {
    const isRow = cs.flexDirection.startsWith('row');
    if (cs.flexWrap === 'wrap' || cs.flexWrap === 'wrap-reverse') {
      return 'grid';
    }
    return isRow ? 'x' : 'y';
  }
  return 'y';
}

// 拖拽移动时确定落点容器：默认取「命中元素的父级」——即在命中兄弟所在层级插入，
// 这样 flex 行内能左右调序（而非钻进某个子项）；命中空容器时则放进其内部。
function resolveMoveContainer(hit: HTMLElement | null, rootEl: HTMLElement, draggedEl: HTMLElement): HTMLElement {
  if (!hit || hit === rootEl) {
    return rootEl;
  }
  const realChildren = (Array.from(hit.children) as HTMLElement[]).filter(
    (c) => c.id !== 'editor-overlay' && c !== draggedEl,
  );
  if (CONTAINER_TAGS.has(hit.tagName) && realChildren.length === 0) {
    return hit;
  }
  const parent = hit.parentElement;
  if (parent && (parent === rootEl || rootEl.contains(parent))) {
    return parent;
  }
  return rootEl;
}

const shadowDomStyles = `
  .overlay-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 999996;
  }

  .hover-overlay {
    position: absolute;
    pointer-events: none;
    box-sizing: border-box;
    z-index: 999997;
    background-color: rgba(0, 102, 255, 0.1);
    border: 1px dashed rgb(0, 87, 255);
  }

  .select-overlay {
    position: absolute;
    pointer-events: none;
    box-sizing: border-box;
    z-index: 999997;
    border: 1px dashed rgb(0, 87, 255);
  }

  .editor-dialog {
    position: absolute;
    z-index: 999998;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    min-width: 320px;
    pointer-events: auto;
    max-height: 80vh;
    overflow: hidden;
  }

  /* 自定义箭头样式 */
  .floating-arrow {
    position: absolute;
    width: 12px;
    height: 12px;
    transform: rotate(45deg);
    background: white;
    z-index: 999997;
    border: 1px solid #e2e8f0;
  }

  /* 选中元素的操作工具条 */
  .editor-toolbar {
    position: absolute;
    z-index: 999999;
    display: flex;
    gap: 2px;
    padding: 4px;
    background: #1e293b;
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    pointer-events: auto;
  }

  .toolbar-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: #e2e8f0;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0;
  }

  .toolbar-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.15);
  }

  .toolbar-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .toolbar-btn.drag-handle {
    cursor: grab;
  }

  .toolbar-btn.drag-handle:active {
    cursor: grabbing;
  }

  /* 拖拽时的插入位置指示线（宽高由内联 rect 给定，支持横/竖两种朝向） */
  .drop-indicator {
    position: absolute;
    background: rgb(0, 87, 255);
    border-radius: 2px;
    pointer-events: none;
    z-index: 999998;
  }
`;

/**
 * 编辑器覆盖层组件，负责在 iframe 内创建和管理覆盖层。
 * 覆盖层用于操作和修改 HTML 元素。
 * 为防止样式覆盖，因此使用 Shadow DOM 创建覆盖层。
 */
export const EditorOverlay: React.FC<EditorOverlayProps> = ({
  selectedElement,
  hoveredElement,
  setHoveredElement,
  setSelectedElement,
  onRequestSave,
  active,
}) => {
  const { document: iframeDocument, window: iframeWindow } = useFrame();
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [selectRect, setSelectRect] = useState<DOMRect | null>(null);
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);
  const hoveredElementRef = useRef<HTMLElement | null>(null);
  const selectedElementRef = useRef<HTMLElement | null>(null);

  const { refs: hoverRefs, floatingStyles: hoverFloatingStyles } = useFloating({
    elements: {
      reference: hoveredElement ?? undefined,
    },
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(({ rects }) => {
        return -rects.reference.height / 2 - rects.floating.height / 2;
      }),
    ],
  });

  const { refs: selectRefs, floatingStyles: selectFloatingStyles } = useFloating({
    elements: {
      reference: selectedElement ?? undefined,
    },
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(({ rects }) => {
        return -rects.reference.height / 2 - rects.floating.height / 2;
      }),
    ],
  });

  const { refs, floatingStyles, context } = useFloating({
    elements: {
      reference: selectedElement ?? undefined,
    },
    whileElementsMounted: autoUpdate,
    placement: 'bottom',
    middleware: [
      offset(10),
      flip({
        fallbackPlacements: ['top'],
        crossAxis: true,
        boundary: iframeDocument?.body || undefined,
      }),
      shift({
        padding: 10,
        limiter: {
          options: {
            offset: 100,
          },
          fn: (state) => {
            const { x, y } = state;
            return {
              x,
              y,
            };
          },
        },
      }),
    ],
  });

  const { getFloatingProps } = useInteractions([useClick(context), useDismiss(context)]);

  // 选中元素操作工具条的浮层定位
  const { refs: toolbarRefs, floatingStyles: toolbarFloatingStyles } = useFloating({
    elements: {
      reference: selectedElement ?? undefined,
    },
    whileElementsMounted: autoUpdate,
    placement: 'top-start',
    middleware: [offset(6), flip({ fallbackPlacements: ['bottom-start'] }), shift({ padding: 8 })],
  });

  // 拖拽插入指示线的位置（相对 iframe 视口坐标）
  const [indicatorRect, setIndicatorRect] = useState<IndicatorRect | null>(null);
  // 移动元素后 selectedElement 引用不变，用它强制刷新工具条的首/尾禁用态
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  // 结构性操作前的内容快照栈，用于「撤销上一步」
  const historyRef = useRef<string[]>([]);
  const [historyLen, setHistoryLen] = useState(0);

  // 跨文档拖放状态（来自组件库面板），驱动放置指示线与最终插入
  const dragState = useStore(componentDragStore);

  useEffect(() => {
    hoveredElementRef.current = hoveredElement;
  }, [hoveredElement]);

  useEffect(() => {
    selectedElementRef.current = selectedElement;
  }, [selectedElement]);

  useEffect(() => {
    if (hoveredElement && hoverRefs.reference.current !== hoveredElement) {
      hoverRefs.reference.current = hoveredElement;
    }
  }, [hoveredElement, hoverRefs]);

  useEffect(() => {
    if (selectedElement && selectRefs.reference.current !== selectedElement) {
      selectRefs.reference.current = selectedElement;
    }
  }, [selectedElement, selectRefs]);

  useEffect(() => {
    if (selectedElement && refs.reference.current !== selectedElement) {
      refs.reference.current = selectedElement;
    }
  }, [selectedElement, refs]);

  useEffect(() => {
    if (selectedElement && toolbarRefs.reference.current !== selectedElement) {
      toolbarRefs.reference.current = selectedElement;
    }
  }, [selectedElement, toolbarRefs]);

  useEffect(() => {
    if (!iframeDocument || !iframeWindow) {
      return;
    }

    const container = iframeDocument.createElement('div');
    container.id = 'editor-overlay';

    iframeDocument.body.appendChild(container);
    const shadow = container.attachShadow({ mode: 'open' });

    const style = iframeDocument.createElement('style');
    style.textContent = shadowDomStyles;
    shadow.appendChild(style);

    const contentContainer = iframeDocument.createElement('div');
    contentContainer.className = 'overlay-container';
    shadow.appendChild(contentContainer);

    setShadowRoot(shadow);

    return () => {
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };
  }, [iframeDocument, iframeWindow]);

  useEffect(() => {
    if (!iframeDocument || !iframeWindow) {
      return;
    }

    const updateHoveredElement = (target: HTMLElement | null) => {
      if (!target || target === iframeDocument.body || target === iframeDocument.documentElement) {
        if (hoveredElementRef.current) {
          hoveredElementRef.current = null;
          setHoveredElement(null);
          setHoverRect(null);
        }
        return;
      }

      if (hoveredElementRef.current === target) {
        return;
      }

      hoveredElementRef.current = target;
      setHoveredElement(target);

      const rect = target.getBoundingClientRect();
      setHoverRect({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        x: rect.x,
        y: rect.y,
        toJSON: rect.toJSON,
      });
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = getTargetElement(e.target);
      if (isOverlayTarget(target, shadowRoot)) {
        return;
      }

      e.stopPropagation();
      updateHoveredElement(target);
    };

    const handleClick = (e: MouseEvent) => {
      const target = getTargetElement(e.target);
      if (isOverlayTarget(target, shadowRoot)) {
        return;
      }

      const selectedTarget = selectedElementRef.current;
      const allowNativeEditingClick = Boolean(
        target &&
          selectedTarget &&
          selectedTarget.isContentEditable &&
          (target === selectedTarget || selectedTarget.contains(target)),
      );

      if (!allowNativeEditingClick) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }

      if (!target || target === iframeDocument.body || target === iframeDocument.documentElement) {
        return;
      }

      if (selectedElementRef.current === target) {
        return;
      }

      selectedElementRef.current = target;
      setSelectedElement(target);

      const rect = target.getBoundingClientRect();
      setSelectRect({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        x: rect.x,
        y: rect.y,
        toJSON: rect.toJSON,
      });
    };

    const handleSubmit = (e: Event) => {
      e.preventDefault();
    };

    const handleMouseOut = (e: MouseEvent) => {
      if (!e.relatedTarget || !iframeDocument.contains(e.relatedTarget as Node)) {
        hoveredElementRef.current = null;
        setHoveredElement(null);
        setHoverRect(null);
      }
    };

    iframeDocument.body.addEventListener('mouseover', handleMouseOver, true);
    iframeDocument.body.addEventListener('click', handleClick, true);
    iframeDocument.body.addEventListener('submit', handleSubmit);
    iframeDocument.addEventListener('mouseout', handleMouseOut);

    return () => {
      iframeDocument.body.removeEventListener('mouseover', handleMouseOver, true);
      iframeDocument.body.removeEventListener('click', handleClick, true);
      iframeDocument.body.removeEventListener('submit', handleSubmit);
      iframeDocument.removeEventListener('mouseout', handleMouseOut);
    };
  }, [iframeDocument, iframeWindow, shadowRoot, setHoveredElement, setSelectedElement, setHoverRect, setSelectRect]);

  // 页面内容根节点（#page-content 下唯一的 #page-{name}），用于快照与撤销
  const getContentRoot = (): HTMLElement | null => {
    const pageContent = iframeDocument?.getElementById('page-content');
    return (pageContent?.firstElementChild as HTMLElement) ?? null;
  };

  // 在执行结构性操作前记录当前内容快照
  const pushHistory = () => {
    const root = getContentRoot();
    if (!root) {
      return;
    }
    historyRef.current.push(root.innerHTML);
    if (historyRef.current.length > 50) {
      historyRef.current.shift();
    }
    setHistoryLen(historyRef.current.length);
  };

  // 向外层「属性」面板发布当前选中元素：仅当前可见页 overlay 发布，避免多页竞态。
  // applyEdit 闭包捕获本 overlay 的撤销/保存链路，使面板改样式也可撤销、可持久化。
  useEffect(() => {
    if (active === false || !iframeWindow) {
      return;
    }
    if (!selectedElement) {
      clearElementSelection();
      return;
    }
    const applyStyle = (mutate: (el: HTMLElement) => void) => {
      mutate(selectedElement);
      forceRender();
    };
    publishElementSelection(selectedElement, iframeWindow, {
      beginEdit: pushHistory,
      applyStyle,
      commitEdit: () => onRequestSave?.(),
    });
    return () => {
      clearElementSelection();
    };
  }, [active, selectedElement, iframeWindow]);

  // 跨文档组件拖放：拖拽中画指示线，松手（phase==='drop'）时把组件注入命中容器并持久化。
  useEffect(() => {
    // 仅当前可见页的 overlay 处理拖放；active 为 undefined 时视为可处理（向后兼容）。
    if (active === false) {
      return;
    }
    if (!iframeDocument || !iframeWindow) {
      return;
    }

    const { phase, activeBlockHtml, pointer } = dragState;
    if (phase === 'idle' || !pointer) {
      setIndicatorRect(null);
      return;
    }

    // 外层主文档坐标 → iframe 视口坐标（画布与 iframe 1:1，无缩放）
    const frameEl = iframeWindow.frameElement as HTMLElement | null;
    if (!frameEl) {
      return;
    }
    const r = frameEl.getBoundingClientRect();
    const ix = pointer.x - r.left;
    const iy = pointer.y - r.top;

    const root = getContentRoot();
    const outOfBounds = ix < 0 || iy < 0 || ix > r.width || iy > r.height;
    if (!root || outOfBounds) {
      setIndicatorRect(null);
      if (phase === 'drop') {
        endComponentDrag();
      }
      return;
    }

    // 命中最上层非 overlay 的页面元素，再上溯到最近容器型祖先
    const stack = iframeDocument.elementsFromPoint(ix, iy) as HTMLElement[];
    const hit = stack.find(
      (node) =>
        node instanceof HTMLElement && !node.closest('#editor-overlay') && (node === root || root.contains(node)),
    );
    const container = findDropContainer(hit ?? root, root);
    // 与画布内拖动保持一致：按容器布局轴向命中，避免把组件拖进 flex-row/grid 时仍按上下方向计算落点。
    const mode = detectDropMode(container, iframeWindow);
    const { dropRef, indicatorRect } =
      mode === 'grid'
        ? computeGridDropTarget(container, ix, iy)
        : computeDropTarget(container, mode === 'x' ? ix : iy, null, mode);

    if (phase === 'dragging') {
      setIndicatorRect(indicatorRect);
      return;
    }

    // phase === 'drop'：注入唯一 id 后插入目标位置，复用撤销栈与保存链路
    const html = (activeBlockHtml ?? '').trim();
    const temp = iframeDocument.createElement('div');
    temp.innerHTML = html;
    const el = temp.firstElementChild as HTMLElement | null;
    if (!el) {
      setIndicatorRect(null);
      endComponentDrag();
      return;
    }
    let id = `comp-${generateCompactUUID()}`;
    while (iframeDocument.getElementById(id)) {
      id = `comp-${generateCompactUUID()}`;
    }
    el.id = id;
    pushHistory();
    container.insertBefore(el, dropRef);
    setSelectedElement(el);
    forceRender();
    onRequestSave?.();
    setIndicatorRect(null);
    endComponentDrag();
  }, [active, dragState, iframeDocument, iframeWindow, setSelectedElement, onRequestSave]);

  if (!iframeDocument || !shadowRoot) {
    return null;
  }

  const overlayContainer = shadowRoot.querySelector('.overlay-container');

  if (!overlayContainer) {
    return null;
  }

  // 获取选中元素在父容器中的同级兄弟（排除 overlay 自身）
  const getOrderedSiblings = (el: HTMLElement): HTMLElement[] => {
    const parent = el.parentElement;
    if (!parent) {
      return [];
    }
    return (Array.from(parent.children) as HTMLElement[]).filter((child) => child.id !== 'editor-overlay');
  };

  // 撤销上一步：恢复最近的内容快照并持久化
  const handleUndo = () => {
    const root = getContentRoot();
    const snapshot = historyRef.current.pop();
    if (!root || snapshot === undefined) {
      return;
    }
    root.innerHTML = snapshot;
    setHistoryLen(historyRef.current.length);
    setHoveredElement(null);
    // 恢复后选中第一个顶层子元素，保持工具条与撤销按钮可继续操作
    setSelectedElement((root.firstElementChild as HTMLElement) ?? null);
    onRequestSave?.();
  };

  // 在同级兄弟间上移(-1)/下移(1)
  const moveSelected = (direction: -1 | 1) => {
    if (!selectedElement) {
      return;
    }
    const parent = selectedElement.parentElement;
    if (!parent) {
      return;
    }
    const siblings = getOrderedSiblings(selectedElement);
    const idx = siblings.indexOf(selectedElement);
    if (idx === -1) {
      return;
    }
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= siblings.length) {
      return;
    }
    pushHistory();
    // 移动前移除编辑属性，避免 contenteditable 被写入保存内容
    selectedElement.removeAttribute('contenteditable');
    // 上移：插到上一个兄弟之前；下移：插到下下个兄弟之前(即下一个兄弟之后)
    const refNode = direction === -1 ? siblings[targetIdx] : (siblings[idx + 2] ?? null);
    parent.insertBefore(selectedElement, refNode);
    forceRender();
    onRequestSave?.();
  };

  const handleDelete = () => {
    if (!selectedElement) {
      return;
    }
    pushHistory();
    // 删除后选中相邻元素（后→前→父），保持工具条与撤销按钮可用
    const siblings = getOrderedSiblings(selectedElement);
    const idx = siblings.indexOf(selectedElement);
    const nextSelected = siblings[idx + 1] ?? siblings[idx - 1] ?? selectedElement.parentElement;
    selectedElement.remove();
    setSelectedElement(nextSelected ?? null);
    onRequestSave?.();
  };

  // 原生 pointer 拖拽：支持跨容器移动 + 轴向感知（flex-row 左右、其余上下）
  const handleDragPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedElement || !iframeWindow) {
      return;
    }
    const root = getContentRoot();
    if (!root) {
      return;
    }

    const draggedEl = selectedElement;
    draggedEl.style.opacity = '0.5';
    draggedEl.removeAttribute('contenteditable');

    // 落点容器与插入参考节点随光标实时更新
    let targetContainer: HTMLElement | null = draggedEl.parentElement;
    let dropRef: Element | null = null;
    let moved = false;

    const handleMove = (ev: PointerEvent) => {
      moved = true;
      // 命中光标下、非被拖元素、非 overlay、且位于内容根内的元素，再向上找最近容器
      const stack = iframeDocument.elementsFromPoint(ev.clientX, ev.clientY) as HTMLElement[];
      const hit = stack.find(
        (n) =>
          n !== draggedEl &&
          !draggedEl.contains(n) &&
          !n.closest('#editor-overlay') &&
          (n === root || root.contains(n)),
      );
      const container = resolveMoveContainer(hit ?? null, root, draggedEl);
      // 不能把元素放进它自身或其后代
      if (container === draggedEl || draggedEl.contains(container)) {
        return;
      }
      const mode = detectDropMode(container, iframeWindow);
      const target =
        mode === 'grid'
          ? computeGridDropTarget(container, ev.clientX, ev.clientY, draggedEl)
          : computeDropTarget(container, mode === 'x' ? ev.clientX : ev.clientY, draggedEl, mode);
      targetContainer = container;
      dropRef = target.dropRef;
      setIndicatorRect(target.indicatorRect);
    };

    const handleUp = () => {
      iframeDocument.removeEventListener('pointermove', handleMove);
      iframeDocument.removeEventListener('pointerup', handleUp);
      draggedEl.style.opacity = '';
      setIndicatorRect(null);
      // 仅在真正拖动且落点不同于自身时才重排，避免「点一下手柄」把元素移到末尾
      if (moved && targetContainer && dropRef !== draggedEl) {
        pushHistory();
        targetContainer.insertBefore(draggedEl, dropRef);
        forceRender();
        onRequestSave?.();
        return;
      }
      forceRender();
    };

    iframeDocument.addEventListener('pointermove', handleMove);
    iframeDocument.addEventListener('pointerup', handleUp);
  };

  const siblings = selectedElement ? getOrderedSiblings(selectedElement) : [];
  const selectedIdx = selectedElement ? siblings.indexOf(selectedElement) : -1;
  const isFirst = selectedIdx <= 0;
  const isLast = selectedIdx === -1 || selectedIdx === siblings.length - 1;

  return ReactDOM.createPortal(
    <>
      {hoveredElement && hoverRect && (
        <div
          ref={hoverRefs.setFloating}
          className="hover-overlay"
          style={{
            ...hoverFloatingStyles,
            width: `${hoverRect.width}px`,
            height: `${hoverRect.height}px`,
          }}
        />
      )}
      {selectedElement && selectRect && (
        <div
          ref={selectRefs.setFloating}
          className="select-overlay"
          style={{
            ...selectFloatingStyles,
            width: `${selectRect.width}px`,
            height: `${selectRect.height}px`,
          }}
        />
      )}
      {selectedElement && (
        <div
          ref={toolbarRefs.setFloating}
          className="editor-toolbar"
          style={toolbarFloatingStyles}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="toolbar-btn"
            title="撤销上一步"
            disabled={historyLen === 0}
            onClick={(e) => {
              e.stopPropagation();
              handleUndo();
            }}
          >
            ↩
          </button>
          <button
            type="button"
            className="toolbar-btn drag-handle"
            title="拖拽移动"
            onPointerDown={handleDragPointerDown}
          >
            ⠿
          </button>
          <button
            type="button"
            className="toolbar-btn"
            title="上移"
            disabled={isFirst}
            onClick={(e) => {
              e.stopPropagation();
              moveSelected(-1);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            className="toolbar-btn"
            title="下移"
            disabled={isLast}
            onClick={(e) => {
              e.stopPropagation();
              moveSelected(1);
            }}
          >
            ↓
          </button>
          <button
            type="button"
            className="toolbar-btn"
            title="删除"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
          >
            🗑
          </button>
        </div>
      )}
      {selectedElement && (
        <div ref={refs.setFloating} className="editor-dialog" style={floatingStyles} {...getFloatingProps()}>
          <EditDialog element={selectedElement} onClose={() => setSelectedElement(null)} />
        </div>
      )}
      {indicatorRect && (
        <div
          className="drop-indicator"
          style={{
            top: `${indicatorRect.top}px`,
            left: `${indicatorRect.left}px`,
            width: `${indicatorRect.width}px`,
            height: `${indicatorRect.height}px`,
          }}
        />
      )}
    </>,
    overlayContainer as Element,
  );
};
