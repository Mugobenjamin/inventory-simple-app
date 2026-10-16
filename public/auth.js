// auth.js: small helpers used by auth pages and dashboard
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Simple auto-redirect if token exists and user is on login/register pages
(function() {
  try {
    const token = localStorage.getItem('token');
    if (token && (location.pathname === '/login' || location.pathname === '/register')) {
      location.href = '/dashboard';
    }
  } catch (e) {}
})();
