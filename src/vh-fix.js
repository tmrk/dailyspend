// iOS Safari viewport height fix
function setVH() {
  let vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}

window.addEventListener('load', setVH);
window.addEventListener('resize', setVH);
window.addEventListener('orientationchange', setVH);

// Additional fix for iOS Safari when the address bar shows/hides
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  // Prevent triggering on iOS when scroll triggers address bar show/hide
  if (lastWidth !== window.innerWidth) {
    lastWidth = window.innerWidth;
    setVH();
  }
});