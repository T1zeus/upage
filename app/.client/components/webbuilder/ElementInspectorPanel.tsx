import { useStore } from '@nanostores/react';
import { useEffect, useRef, useState } from 'react';
import { elementSelectionStore } from '~/.client/stores/element-selection';

interface Props {
  className?: string;
}

// 编辑项的内联样式键集合：从 computedStyle/内联样式读种子，写回 el.style。
type StyleKey =
  | 'width'
  | 'height'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'marginTop'
  | 'marginRight'
  | 'marginBottom'
  | 'marginLeft'
  | 'display'
  | 'flexDirection'
  | 'justifyContent'
  | 'alignItems'
  | 'gap'
  | 'fontSize'
  | 'fontWeight'
  | 'color'
  | 'textAlign'
  | 'backgroundColor'
  | 'borderWidth'
  | 'borderStyle'
  | 'borderColor'
  | 'borderRadius';

type StyleValues = Record<StyleKey, string>;
type StyleHints = Partial<Record<StyleKey, string>>;

// 去掉 px 后缀返回纯数字字符串；非数值（auto/normal/空）返回空串。
function stripPx(value: string): string {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? String(Math.round(n)) : '';
}

// 尺寸输入归一：纯数字补 px（如 320→320px），带单位/关键字（100%/auto/24rem）原样保留，空串表示移除。
function parseDimValue(raw: string): string {
  const v = raw.trim();
  if (v === '') {
    return '';
  }
  return /^-?\d*\.?\d+$/.test(v) ? `${v}px` : v;
}

// computed 颜色多为 rgb()/rgba()，<input type=color> 需 #rrggbb，这里做转换。
function rgbToHex(value: string): string {
  if (value.startsWith('#')) {
    return value;
  }
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) {
    return '#000000';
  }
  const parts = m[1].split(',').map((p) => Number.parseFloat(p.trim()));
  const [r, g, b] = parts;
  if (![r, g, b].every((c) => Number.isFinite(c))) {
    return '#000000';
  }
  const hex = (c: number) => c.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// 文字对齐 computed 可能是 start/end，归一到 select 选项。
function normalizeTextAlign(value: string): string {
  if (value === 'start') {
    return 'left';
  }
  if (value === 'end') {
    return 'right';
  }
  return value;
}

interface Seed {
  values: StyleValues;
  hints: StyleHints;
}

// 种子读取原则：尺寸/间距/字号优先读内联值，无内联时回退到 computed（显示当前生效值，避免输入框空着像被禁用）；
// width/height 保留单位原样（100%/auto/24rem），无内联时回退 computed px；display/对齐/颜色等取 computed 反映实际生效值。
function readSeed(el: HTMLElement, win: Window): Seed {
  const cs = win.getComputedStyle(el);
  const inline = el.style;
  const inlinePx = (prop: string) => stripPx(inline.getPropertyValue(prop));
  // 尺寸字段保留单位原样（如 100%/auto/24rem），避免编辑时把响应式 class 值强制改成 px。
  const inlineRaw = (prop: string) => inline.getPropertyValue(prop).trim();
  const compPx = (prop: string) => stripPx(cs.getPropertyValue(prop));

  return {
    values: {
      width: inlineRaw('width') || compPx('width'),
      height: inlineRaw('height') || compPx('height'),
      paddingTop: inlinePx('padding-top') || compPx('padding-top'),
      paddingRight: inlinePx('padding-right') || compPx('padding-right'),
      paddingBottom: inlinePx('padding-bottom') || compPx('padding-bottom'),
      paddingLeft: inlinePx('padding-left') || compPx('padding-left'),
      marginTop: inlinePx('margin-top') || compPx('margin-top'),
      marginRight: inlinePx('margin-right') || compPx('margin-right'),
      marginBottom: inlinePx('margin-bottom') || compPx('margin-bottom'),
      marginLeft: inlinePx('margin-left') || compPx('margin-left'),
      display: cs.display,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      gap: inlinePx('gap') || compPx('gap'),
      fontSize: inlinePx('font-size') || compPx('font-size'),
      fontWeight: String(Number.parseInt(cs.fontWeight, 10) || 400),
      color: rgbToHex(cs.color),
      textAlign: normalizeTextAlign(cs.textAlign),
      backgroundColor: rgbToHex(cs.backgroundColor),
      borderWidth: inlinePx('border-top-width') || compPx('border-top-width'),
      borderStyle: cs.borderTopStyle || 'none',
      borderColor: rgbToHex(cs.borderTopColor),
      borderRadius: inlinePx('border-top-left-radius') || compPx('border-top-left-radius'),
    },
    hints: {
      width: compPx('width'),
      height: compPx('height'),
      paddingTop: compPx('padding-top'),
      paddingRight: compPx('padding-right'),
      paddingBottom: compPx('padding-bottom'),
      paddingLeft: compPx('padding-left'),
      marginTop: compPx('margin-top'),
      marginRight: compPx('margin-right'),
      marginBottom: compPx('margin-bottom'),
      marginLeft: compPx('margin-left'),
      gap: compPx('gap'),
      fontSize: compPx('font-size'),
      borderWidth: compPx('border-top-width'),
      borderRadius: compPx('border-top-left-radius'),
    },
  };
}

const labelCls = 'text-xs text-upage-elements-textTertiary';
const fieldCls =
  'w-full px-2 py-1 text-sm rounded border border-upage-elements-borderColor bg-upage-elements-background-depth-1 text-upage-elements-textPrimary focus:outline-none focus:ring-1 focus:ring-upage-elements-borderColorActive';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-upage-elements-textSecondary pt-1">{children}</div>;
}

export function ElementInspectorPanel({ className }: Props) {
  const sel = useStore(elementSelectionStore);
  const [seed, setSeed] = useState<Seed | null>(null);
  // 一次输入是否已记录撤销快照：首次改动时置位，失焦提交后复位，避免每次按键都入栈。
  const editingRef = useRef(false);

  // 选中目标变化或外部就地修改（nonce 自增）时重读种子值。
  useEffect(() => {
    editingRef.current = false;
    if (sel.element && sel.win) {
      setSeed(readSeed(sel.element, sel.win));
    } else {
      setSeed(null);
    }
  }, [sel.element, sel.win, sel.nonce]);

  if (!sel.element || !seed) {
    return (
      <div className={className}>
        <div className="p-4 text-sm text-upage-elements-textTertiary">在画布中选择一个元素以编辑其样式。</div>
      </div>
    );
  }

  const { values, hints } = seed;

  // 实时预览：首次改动记一次撤销快照，随后只改 DOM（空值移除内联属性，回退到原 class）。
  // value 写入 DOM（带单位，如 16px）；displayValue 写回面板输入框（数字框需纯数字，否则受控 value 非法被清空）。
  const onStyleChange = (key: StyleKey, cssProp: string, value: string, displayValue: string = value) => {
    if (!editingRef.current) {
      sel.beginEdit?.();
      editingRef.current = true;
    }
    // 边框陷阱：只填宽/色而 border-style 仍为 none 时浏览器不渲染边框，自动补 solid。
    const autoSolid =
      value !== '' &&
      (cssProp === 'border-width' || cssProp === 'border-color') &&
      (values.borderStyle === 'none' || values.borderStyle === '');
    setSeed((prev) =>
      prev
        ? { ...prev, values: { ...prev.values, [key]: displayValue, ...(autoSolid ? { borderStyle: 'solid' } : {}) } }
        : prev,
    );
    sel.applyStyle?.((el) => {
      if (value === '') {
        el.style.removeProperty(cssProp);
      } else {
        // 带 !important：内联 !important 才能压过 LLM 生成页常用的 `!text-*`/`!font-*` 等带 !important 的 Tailwind 类。
        el.style.setProperty(cssProp, value, 'important');
      }
      if (autoSolid) {
        el.style.setProperty('border-style', 'solid', 'important');
      }
    });
  };

  // 提交：失焦时才真正持久化保存。
  const onStyleCommit = () => {
    if (editingRef.current) {
      sel.commitEdit?.();
      editingRef.current = false;
    }
  };

  // 离散选择（下拉）：改动后立即提交。
  const onSelectChange = (key: StyleKey, cssProp: string, value: string) => {
    onStyleChange(key, cssProp, value);
    onStyleCommit();
  };

  const pxField = (key: StyleKey, cssProp: string, label: string) => (
    <Field label={label}>
      <input
        type="number"
        className={fieldCls}
        value={values[key]}
        placeholder={hints[key] ?? 'auto'}
        onChange={(e) => {
          const v = e.target.value;
          onStyleChange(key, cssProp, v === '' ? '' : `${v}px`, v);
        }}
        onBlur={onStyleCommit}
      />
    </Field>
  );

  // 单位感知文本输入：接受 100%/auto/24rem，纯数字默认 px；空值移除内联回退 class。
  const dimField = (key: StyleKey, cssProp: string, label: string) => (
    <Field label={label}>
      <input
        type="text"
        className={fieldCls}
        value={values[key]}
        placeholder={hints[key] ?? 'auto'}
        onChange={(e) => onStyleChange(key, cssProp, parseDimValue(e.target.value), e.target.value)}
        onBlur={onStyleCommit}
      />
    </Field>
  );

  // 四向间距：上/右/下/左 各一格，整体占满面板宽度。
  const boxField = (
    label: string,
    keys: [StyleKey, StyleKey, StyleKey, StyleKey],
    cssProps: [string, string, string, string],
  ) => {
    const titles = ['上', '右', '下', '左'];
    return (
      <Field label={label}>
        <div className="grid grid-cols-4 gap-1">
          {keys.map((key, i) => (
            <input
              key={key}
              type="number"
              title={titles[i]}
              className="w-full px-1 py-1 text-sm text-center rounded border border-upage-elements-borderColor bg-upage-elements-background-depth-1 text-upage-elements-textPrimary focus:outline-none focus:ring-1 focus:ring-upage-elements-borderColorActive"
              value={values[key]}
              placeholder={hints[key] ?? '0'}
              onChange={(e) => {
                const v = e.target.value;
                onStyleChange(key, cssProps[i], v === '' ? '' : `${v}px`, v);
              }}
              onBlur={onStyleCommit}
            />
          ))}
        </div>
      </Field>
    );
  };

  const colorField = (key: StyleKey, cssProp: string, label: string) => (
    <Field label={label}>
      <input
        type="color"
        className="h-8 w-full rounded border border-upage-elements-borderColor bg-upage-elements-background-depth-1"
        value={values[key]}
        onChange={(e) => onStyleChange(key, cssProp, e.target.value)}
        onBlur={onStyleCommit}
      />
    </Field>
  );

  const selectField = (key: StyleKey, cssProp: string, label: string, options: string[]) => {
    // 计算值可能落在选项之外（如字重 800、display:inline-flex、边框 double）：
    // 并入当前值，避免受控 select 因 value 无匹配项而错误显示首项/空。
    const current = values[key];
    const opts = current && !options.includes(current) ? [current, ...options] : options;
    return (
      <Field label={label}>
        <select className={fieldCls} value={current} onChange={(e) => onSelectChange(key, cssProp, e.target.value)}>
          {opts.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </Field>
    );
  };

  const isFlex = values.display === 'flex' || values.display === 'inline-flex';

  return (
    <div className={`${className ?? ''} overflow-y-auto modern-scrollbar`}>
      <div className="p-2 border-b border-upage-elements-borderColor bg-upage-elements-background-depth-1">
        <h3 className="font-medium text-upage-elements-textPrimary">
          属性
          <span className="ml-2 text-xs text-upage-elements-textTertiary">
            &lt;{sel.element.tagName.toLowerCase()}&gt;
          </span>
        </h3>
      </div>

      <div className="p-3 space-y-4">
        <div className="space-y-2">
          <GroupTitle>尺寸 + 间距</GroupTitle>
          <div className="grid grid-cols-2 gap-2">
            {dimField('width', 'width', '宽度')}
            {dimField('height', 'height', '高度')}
          </div>
          {boxField(
            '内边距 (px)',
            ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
            ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
          )}
          {boxField(
            '外边距 (px)',
            ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
            ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
          )}
        </div>

        <div className="space-y-2">
          <GroupTitle>布局</GroupTitle>
          <div className="grid grid-cols-2 gap-2">
            {selectField('display', 'display', '显示', ['block', 'flex', 'grid', 'inline-block', 'none'])}
            {isFlex && selectField('flexDirection', 'flex-direction', '方向', ['row', 'column'])}
            {isFlex &&
              selectField('justifyContent', 'justify-content', '主轴', [
                'flex-start',
                'center',
                'flex-end',
                'space-between',
                'space-around',
              ])}
            {isFlex &&
              selectField('alignItems', 'align-items', '交叉轴', ['stretch', 'flex-start', 'center', 'flex-end'])}
            {isFlex && pxField('gap', 'gap', '间隔 (px)')}
          </div>
        </div>

        <div className="space-y-2">
          <GroupTitle>文字</GroupTitle>
          <div className="grid grid-cols-2 gap-2">
            {pxField('fontSize', 'font-size', '字号 (px)')}
            {selectField('fontWeight', 'font-weight', '字重', ['400', '500', '600', '700'])}
            {colorField('color', 'color', '颜色')}
            {selectField('textAlign', 'text-align', '对齐', ['left', 'center', 'right', 'justify'])}
          </div>
        </div>

        <div className="space-y-2">
          <GroupTitle>背景 + 边框</GroupTitle>
          <div className="grid grid-cols-2 gap-2">
            {colorField('backgroundColor', 'background-color', '背景色')}
            {pxField('borderWidth', 'border-width', '边框宽 (px)')}
            {selectField('borderStyle', 'border-style', '边框线', ['none', 'solid', 'dashed', 'dotted'])}
            {colorField('borderColor', 'border-color', '边框色')}
            {pxField('borderRadius', 'border-radius', '圆角 (px)')}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ElementInspectorPanel;
