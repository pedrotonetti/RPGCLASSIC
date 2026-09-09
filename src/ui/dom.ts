type Child = Node | string | null | undefined | false;

interface ElOptions {
  className?: string;
  text?: string;
  onClick?: (ev: MouseEvent) => void;
  onPointerDown?: (ev: PointerEvent) => void;
  onPointerUp?: (ev: PointerEvent) => void;
  style?: Partial<CSSStyleDeclaration>;
  attrs?: Record<string, string>;
}

/** Tiny hyperscript-style helper: el('div', {className: 'foo'}, [child, child]) */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.onClick) node.addEventListener('click', options.onClick as EventListener);
  if (options.onPointerDown) node.addEventListener('pointerdown', options.onPointerDown as EventListener);
  if (options.onPointerUp) node.addEventListener('pointerup', options.onPointerUp as EventListener);
  if (options.style) Object.assign(node.style, options.style);
  if (options.attrs) {
    for (const [k, v] of Object.entries(options.attrs)) node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}
