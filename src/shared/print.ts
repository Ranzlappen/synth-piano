// HTML document that lays out engraved SVG pages for printing / PDF generation.

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function pagesToHtml(req: {
  pages: string[];
  widthMm: number;
  heightMm: number;
  title: string;
}): string {
  const w = `${req.widthMm}mm`;
  const h = `${req.heightMm}mm`;
  const pages = req.pages.map((svg) => `<section class="page">${svg}</section>`).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(req.title)}</title>
<style>
@page { size: ${w} ${h}; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.page { width: ${w}; height: ${h}; overflow: hidden; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
.page > svg { display: block; width: 100%; height: 100%; }
</style></head><body>
${pages}
</body></html>`;
}
