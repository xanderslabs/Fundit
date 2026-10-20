// Entry for gate0.html. The page loads with import(), so none of its modules count as first-load modules: the
// first-load chunk groups in vite.config.ts (viem, react, query) stay exactly what the app's own pages need.
void import('./page')
