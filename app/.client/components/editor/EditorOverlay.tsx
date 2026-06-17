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
import React, { useEffect, useReducer, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useFrame } from 'react-frame-component';
import { EditDialog } from './EditDialog';

export interface EditorOverlayProps {
  selectedElement: HTMLElement | null;
  hoveredElement: HTMLElement | null;
  setHoveredElement: (element: HTMLElement | null) => void;
  setSelectedElement: (element: HTMLElement | null) => void;
  onRequestSave?: () => void;
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

  /* 拖拽时的插入位置指示线 */
  .drop-indicator {
    position: absolute;
    height: 3px;
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
  const [indicatorRect, setIndicatorRect] = useState<{ top: number; left: number; width: number } | null>(null);
  // 移动元素后 selectedElement 引用不变，用它强制刷新工具条的首/尾禁用态
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  // 结构性操作前的内容快照栈，用于「撤销上一步」
  const historyRef = useRef<string[]>([]);
  const [historyLen, setHistoryLen] = useState(0);

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

  // 原生 pointer 拖拽，仅在同一父容器内重排
  const handleDragPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedElement) {
      return;
    }
    const parent = selectedElement.parentElement;
    if (!parent) {
      return;
    }

    const draggedEl = selectedElement;
    draggedEl.style.opacity = '0.5';
    draggedEl.removeAttribute('contenteditable');

    let dropRef: Element | null = null;
    let moved = false;

    const handleMove = (ev: PointerEvent) => {
      moved = true;
      const siblings = (Array.from(parent.children) as HTMLElement[]).filter(
        (child) => child.id !== 'editor-overlay' && child !== draggedEl,
      );
      dropRef = null;
      for (const sib of siblings) {
        const rect = sib.getBoundingClientRect();
        if (ev.clientY < rect.top + rect.height / 2) {
          dropRef = sib;
          break;
        }
      }
      // 计算插入指示线位置（iframe 视口坐标，overlay-container 锚定在 body 左上角）
      const parentRect = parent.getBoundingClientRect();
      let top: number;
      if (dropRef) {
        top = dropRef.getBoundingClientRect().top;
      } else if (siblings.length > 0) {
        top = siblings[siblings.length - 1].getBoundingClientRect().bottom;
      } else {
        top = parentRect.top;
      }
      setIndicatorRect({ top: top - 1.5, left: parentRect.left, width: parentRect.width });
    };

    const handleUp = () => {
      iframeDocument.removeEventListener('pointermove', handleMove);
      iframeDocument.removeEventListener('pointerup', handleUp);
      draggedEl.style.opacity = '';
      setIndicatorRect(null);
      // 仅在真正拖动且落点不同于自身时才重排，避免「点一下手柄」把元素移到末尾
      if (moved && dropRef !== draggedEl) {
        pushHistory();
        parent.insertBefore(draggedEl, dropRef);
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
          }}
        />
      )}
    </>,
    overlayContainer as Element,
  );
};
