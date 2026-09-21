/* Native window bridge is preview-only: a size signal, never a backend command. */
(() => {
  const root = document.querySelector('#product-root');
  const native = Boolean(window.nativeQuery);
  if (native) {
    document.body.classList.add('native');
    const signalSize = () => {
      const panel = root.querySelector('.glass-panel, .closed-panel');
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      window.webkit?.messageHandlers?.previewSize?.postMessage({width: rect.width, height: rect.height});
    };
    const resize = new ResizeObserver(signalSize);
    new MutationObserver(() => {
      resize.disconnect();
      const panel = root.querySelector('.glass-panel, .closed-panel');
      if (panel) resize.observe(panel);
    }).observe(root, {childList: true});
    if (root.firstElementChild) resize.observe(root.firstElementChild);
    signalSize();
  }
})();
