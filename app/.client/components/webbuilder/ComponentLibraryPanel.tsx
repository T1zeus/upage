import classNames from 'classnames';
import { useCallback, useRef } from 'react';
import { type ComponentBlock, componentCategories, componentLibrary } from '~/.client/data/component-library';
import {
  commitComponentDrag,
  endComponentDrag,
  startComponentDrag,
  updateComponentDragPointer,
} from '~/.client/stores/component-drag';

interface Props {
  className?: string;
}

const GHOST_OFFSET = 12;

export function ComponentLibraryPanel({ className }: Props) {
  // 跟随光标的拖拽残影（外层主文档）
  const ghostRef = useRef<HTMLDivElement | null>(null);

  const removeGhost = useCallback(() => {
    ghostRef.current?.remove();
    ghostRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, block: ComponentBlock) => {
      // 仅响应主键按下，避免右键/触控笔副键误触
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();

      const el = e.currentTarget;
      const pointerId = e.pointerId;
      // 指针捕获：光标移到 iframe 上方时，事件仍回流到外层捕获元素，是跨 iframe 拖放的关键。
      el.setPointerCapture(pointerId);

      startComponentDrag(block.html, { x: e.clientX, y: e.clientY });

      const ghost = document.createElement('div');
      ghost.textContent = block.name;
      ghost.style.cssText = [
        'position:fixed',
        `left:${e.clientX + GHOST_OFFSET}px`,
        `top:${e.clientY + GHOST_OFFSET}px`,
        'padding:4px 10px',
        'font-size:12px',
        'border-radius:6px',
        'background:#1e293b',
        'color:#fff',
        'box-shadow:0 4px 12px rgba(0,0,0,0.25)',
        'pointer-events:none',
        'z-index:99999',
        'white-space:nowrap',
      ].join(';');
      document.body.appendChild(ghost);
      ghostRef.current = ghost;

      const handleMove = (ev: PointerEvent) => {
        if (ghostRef.current) {
          ghostRef.current.style.left = `${ev.clientX + GHOST_OFFSET}px`;
          ghostRef.current.style.top = `${ev.clientY + GHOST_OFFSET}px`;
        }
        updateComponentDragPointer({ x: ev.clientX, y: ev.clientY });
      };

      const cleanup = () => {
        el.removeEventListener('pointermove', handleMove);
        el.removeEventListener('pointerup', handleUp);
        el.removeEventListener('pointercancel', handleCancel);
        if (el.hasPointerCapture(pointerId)) {
          el.releasePointerCapture(pointerId);
        }
        removeGhost();
      };

      const handleUp = (ev: PointerEvent) => {
        cleanup();
        // 提交放置：保留 html 与最终坐标，由 iframe 内 overlay 完成插入。
        commitComponentDrag({ x: ev.clientX, y: ev.clientY });
      };

      const handleCancel = () => {
        cleanup();
        endComponentDrag();
      };

      el.addEventListener('pointermove', handleMove);
      el.addEventListener('pointerup', handleUp);
      el.addEventListener('pointercancel', handleCancel);
    },
    [removeGhost],
  );

  return (
    <div className={classNames('text-sm overflow-y-auto modern-scrollbar', className)}>
      <div className="p-2 border-b border-upage-elements-borderColor bg-upage-elements-background-depth-1">
        <h3 className="font-medium text-upage-elements-textPrimary">组件库</h3>
      </div>
      <div className="p-2 space-y-4">
        {componentCategories.map((category) => {
          const blocks = componentLibrary.filter((block) => block.category === category.key);
          if (blocks.length === 0) {
            return null;
          }
          return (
            <div key={category.key}>
              <div className="px-1 pb-1 text-xs font-medium text-upage-elements-textTertiary">{category.label}</div>
              <div className="grid grid-cols-2 gap-2">
                {blocks.map((block) => (
                  <button
                    key={block.id}
                    type="button"
                    title={`拖拽「${block.name}」到画布`}
                    onPointerDown={(e) => handlePointerDown(e, block)}
                    className="flex flex-col items-center justify-center gap-1 py-3 rounded-md border border-upage-elements-borderColor bg-upage-elements-background-depth-1 text-upage-elements-textPrimary cursor-grab select-none hover:bg-upage-elements-item-backgroundActive hover:border-upage-elements-borderColorActive transition-colors"
                  >
                    <span className="text-lg leading-none">{block.icon}</span>
                    <span className="text-xs">{block.name}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ComponentLibraryPanel;
