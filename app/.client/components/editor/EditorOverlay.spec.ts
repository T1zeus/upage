import { describe, expect, it } from 'vitest';
import { computeDropTarget, computeGridDropTarget } from './EditorOverlay';

// jsdom 不做真实布局，getBoundingClientRect 默认全 0，这里按需桩入受控矩形。
function stubRect(el: Element, rect: { top: number; bottom: number; left?: number; width?: number }) {
  el.getBoundingClientRect = () =>
    ({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left ?? 0,
      right: (rect.left ?? 0) + (rect.width ?? 0),
      width: rect.width ?? 0,
      height: rect.bottom - rect.top,
      x: rect.left ?? 0,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

// 构造一个横向排列的父容器，子元素按 left/width 桩入矩形。
function makeRowParent(childRects: Array<{ left: number; width: number }>) {
  const parent = document.createElement('div');
  stubRect(parent, { top: 5, bottom: 105, left: 0, width: 400 });
  for (const r of childRects) {
    const child = document.createElement('div');
    stubRect(child, { top: 5, bottom: 105, left: r.left, width: r.width });
    parent.appendChild(child);
  }
  return parent;
}

function makeParent(childRects: Array<{ top: number; bottom: number }>) {
  const parent = document.createElement('div');
  stubRect(parent, { top: 0, bottom: 300, left: 10, width: 200 });
  for (const r of childRects) {
    const child = document.createElement('div');
    stubRect(child, r);
    parent.appendChild(child);
  }
  return parent;
}

describe('computeDropTarget', () => {
  it('命中落在第一个子元素上半部分时，dropRef 指向第一个子元素', () => {
    const parent = makeParent([
      { top: 0, bottom: 100 },
      { top: 100, bottom: 200 },
    ]);
    // y=40 < 第一个子元素中线(50) → 插到第一个之前
    const { dropRef } = computeDropTarget(parent, 40);
    expect(dropRef).toBe(parent.children[0]);
  });

  it('命中落在两个子元素之间时，dropRef 指向后一个子元素', () => {
    const parent = makeParent([
      { top: 0, bottom: 100 },
      { top: 100, bottom: 200 },
    ]);
    // y=120 > 第一个中线(50)，< 第二个中线(150) → 插到第二个之前
    const { dropRef } = computeDropTarget(parent, 120);
    expect(dropRef).toBe(parent.children[1]);
  });

  it('命中落在所有子元素下方时，dropRef 为 null（追加到末尾），指示线在最后一个底部', () => {
    const parent = makeParent([
      { top: 0, bottom: 100 },
      { top: 100, bottom: 200 },
    ]);
    const { dropRef, indicatorRect } = computeDropTarget(parent, 260);
    expect(dropRef).toBeNull();
    expect(indicatorRect.top).toBe(200 - 1.5);
    expect(indicatorRect.left).toBe(10);
    expect(indicatorRect.width).toBe(200);
  });

  it('空容器时 dropRef 为 null，指示线对齐父容器顶部', () => {
    const parent = makeParent([]);
    const { dropRef, indicatorRect } = computeDropTarget(parent, 50);
    expect(dropRef).toBeNull();
    expect(indicatorRect.top).toBe(0 - 1.5);
  });

  it('排除被拖拽元素与 overlay 自身', () => {
    const parent = makeParent([
      { top: 0, bottom: 100 },
      { top: 100, bottom: 200 },
    ]);
    const overlay = document.createElement('div');
    overlay.id = 'editor-overlay';
    parent.appendChild(overlay);
    const dragged = parent.children[0] as HTMLElement;
    // 拖拽第一个元素，y=40 命中它自身的位置，但它被排除 → 命中第二个
    const { dropRef } = computeDropTarget(parent, 40, dragged);
    expect(dropRef).toBe(parent.children[1]);
  });
});

describe('computeDropTarget axis="x"（左右排列）', () => {
  it('命中落在第一个子元素左半部分时，dropRef 指向第一个子元素，指示线为竖线', () => {
    const parent = makeRowParent([
      { left: 0, width: 100 },
      { left: 100, width: 100 },
    ]);
    // x=40 < 第一个子元素水平中线(50) → 插到第一个之前
    const { dropRef, indicatorRect } = computeDropTarget(parent, 40, null, 'x');
    expect(dropRef).toBe(parent.children[0]);
    // 竖线：宽 3，高=父容器高(100)，left 对齐第一个子元素左缘(0)-1.5
    expect(indicatorRect.width).toBe(3);
    expect(indicatorRect.height).toBe(100);
    expect(indicatorRect.left).toBe(0 - 1.5);
    expect(indicatorRect.top).toBe(5);
  });

  it('命中落在两个子元素之间时，dropRef 指向后一个子元素', () => {
    const parent = makeRowParent([
      { left: 0, width: 100 },
      { left: 100, width: 100 },
    ]);
    // x=120 > 第一个中线(50)，< 第二个中线(150) → 插到第二个之前
    const { dropRef } = computeDropTarget(parent, 120, null, 'x');
    expect(dropRef).toBe(parent.children[1]);
  });

  it('命中落在所有子元素右侧时，dropRef 为 null，竖线在末尾子元素右缘', () => {
    const parent = makeRowParent([
      { left: 0, width: 100 },
      { left: 100, width: 100 },
    ]);
    const { dropRef, indicatorRect } = computeDropTarget(parent, 260, null, 'x');
    expect(dropRef).toBeNull();
    expect(indicatorRect.left).toBe(200 - 1.5);
  });
});

// 构造 2x2 网格容器：按 top/left/width/height 桩入每个子项矩形。
function makeGridParent(childRects: Array<{ top: number; left: number; width: number; height: number }>) {
  const parent = document.createElement('div');
  stubRect(parent, { top: 0, bottom: 200, left: 0, width: 200 });
  for (const r of childRects) {
    const child = document.createElement('div');
    stubRect(child, { top: r.top, bottom: r.top + r.height, left: r.left, width: r.width });
    parent.appendChild(child);
  }
  return parent;
}

describe('computeGridDropTarget（网格/换行二维命中）', () => {
  // 2x2：[0]左上 [1]右上 [2]左下 [3]右下，各 100x100。
  const grid = () =>
    makeGridParent([
      { top: 0, left: 0, width: 100, height: 100 },
      { top: 0, left: 100, width: 100, height: 100 },
      { top: 100, left: 0, width: 100, height: 100 },
      { top: 100, left: 100, width: 100, height: 100 },
    ]);

  it('落在某子项左半区时，dropRef 指向该子项，竖线贴其左缘且与其等高', () => {
    const parent = grid();
    // (x=120,y=20)：最近右上子项[1]，x<150（其水平中线）→ 插到[1]之前
    const { dropRef, indicatorRect } = computeGridDropTarget(parent, 120, 20, null);
    expect(dropRef).toBe(parent.children[1]);
    expect(indicatorRect.left).toBe(100 - 1.5);
    expect(indicatorRect.top).toBe(0);
    expect(indicatorRect.height).toBe(100);
    expect(indicatorRect.width).toBe(3);
  });

  it('落在某子项右半区时，dropRef 指向下一个子项，竖线贴命中子项右缘', () => {
    const parent = grid();
    // (x=180,y=20)：最近右上子项[1]，x>150 → 插到下一个[2]之前
    const { dropRef, indicatorRect } = computeGridDropTarget(parent, 180, 20, null);
    expect(dropRef).toBe(parent.children[2]);
    expect(indicatorRect.left).toBe(200 - 1.5);
  });

  it('落在最后一个子项右半区时，dropRef 为 null（追加末尾）', () => {
    const parent = grid();
    // (x=180,y=180)：最近右下子项[3]，x>150 → 无下一个 → null
    const { dropRef } = computeGridDropTarget(parent, 180, 180, null);
    expect(dropRef).toBeNull();
  });

  it('就近命中按二维距离：落在左下区域命中左下子项', () => {
    const parent = grid();
    // (x=20,y=180)：最近左下子项[2]，x<50 → 插到[2]之前
    const { dropRef } = computeGridDropTarget(parent, 20, 180, null);
    expect(dropRef).toBe(parent.children[2]);
  });

  it('空容器时 dropRef 为 null，竖线对齐父容器左缘', () => {
    const parent = makeGridParent([]);
    const { dropRef, indicatorRect } = computeGridDropTarget(parent, 50, 50, null);
    expect(dropRef).toBeNull();
    expect(indicatorRect.left).toBe(0 - 1.5);
    expect(indicatorRect.height).toBe(200);
  });
});
