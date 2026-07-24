/** Tiny DOM helpers so the Studio can build its UI without a framework. */

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    } else if (key === 'class') {
      el.className = String(value)
    } else if (key === 'html') {
      el.innerHTML = String(value)
    } else if (value === true) {
      el.setAttribute(key, '')
    } else {
      el.setAttribute(key, String(value))
    }
  }

  for (const child of children) {
    if (child === null || child === undefined) continue
    el.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }

  return el
}

export function download(filename: string, contents: string, type = 'application/json') {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function injectStyles(id: string, css: string) {
  if (document.querySelector(`style[data-narvyaka="${id}"]`)) return
  const style = document.createElement('style')
  style.dataset.narvyaka = id
  style.textContent = css
  document.head.appendChild(style)
}
