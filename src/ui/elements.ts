export function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
export function button(
  document: Document,
  text: string,
  action: () => void,
): HTMLButtonElement {
  const node = element(document, 'button', '', text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
