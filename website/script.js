const menuButton = document.querySelector('.menu-button');
const nav = document.querySelector('nav');

menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!open));
  nav.classList.toggle('open', !open);
});

document.querySelectorAll('nav a').forEach((link) => link.addEventListener('click', () => {
  menuButton.setAttribute('aria-expanded', 'false');
  nav.classList.remove('open');
}));

const copyButton = document.querySelector('#copy-command');
const toast = document.querySelector('.toast');
const command = 'npm run build\nwsl -d Ubuntu -u root -- bash -lc "cd /mnt/c/Users/deok7/LxcProgramMade && npm start"';

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(command);
    copyButton.textContent = 'Copied';
    toast.classList.add('show');
    window.setTimeout(() => {
      copyButton.textContent = 'Copy';
      toast.classList.remove('show');
    }, 2200);
  } catch {
    copyButton.textContent = 'Select';
  }
});

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.feature-grid article, .steps article, .start-card').forEach((item) => {
  item.classList.add('reveal');
  revealObserver.observe(item);
});
