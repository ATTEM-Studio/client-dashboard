(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {
      // The dashboard remains fully usable in the browser if installation is unavailable.
    });
  });
})();
