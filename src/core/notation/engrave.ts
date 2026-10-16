// Page layout for the Verovio engraver and the page header/footer (title block,
// running title, page numbers, copyright) injected into the MEI before rendering.

import { escapeXml } from './musicxml';
import { PAPER_SIZES, type SheetExportOptions } from './options';

/** Verovio draws a 7.2 mm staff when 10 layout units equal 1 mm. */
const VEROVIO_STAFF_MM_AT_10_UNITS = 7.2;

export interface PageGeometry {
  widthMm: number;
  heightMm: number;
  unitsPerMm: number;
}

export function pageGeometry(o: SheetExportOptions): PageGeometry {
  const paper = PAPER_SIZES[o.paper];
  const [w, h] = o.landscape ? [paper.heightMm, paper.widthMm] : [paper.widthMm, paper.heightMm];
  return { widthMm: w, heightMm: h, unitsPerMm: (10 * VEROVIO_STAFF_MM_AT_10_UNITS) / o.staffSizeMm };
}

export function buildVerovioOptions(o: SheetExportOptions): Record<string, unknown> {
  const g = pageGeometry(o);
  const u = (mm: number) => Math.round(mm * g.unitsPerMm);
  const spacing = {
    compact: { spacingStaff: 8, spacingSystem: 6, spacingLinear: 0.22, spacingNonLinear: 0.55 },
    normal: { spacingStaff: 12, spacingSystem: 12, spacingLinear: 0.25, spacingNonLinear: 0.6 },
    spacious: { spacingStaff: 16, spacingSystem: 20, spacingLinear: 0.3, spacingNonLinear: 0.65 },
  }[o.spacing];
  return {
    pageWidth: u(g.widthMm),
    pageHeight: u(g.heightMm),
    pageMarginTop: u(o.marginTopMm),
    pageMarginBottom: u(o.marginBottomMm),
    pageMarginLeft: u(o.marginSideMm),
    pageMarginRight: u(o.marginSideMm),
    scale: 40,
    adjustPageHeight: false,
    svgViewBox: true,
    font: o.font,
    header: 'encoded',
    footer: 'encoded',
    breaks: o.measuresPerSystem > 0 ? 'line' : 'auto',
    systemMaxPerPage: o.systemsPerPage,
    mnumInterval: o.measureNumbers === 'every' ? 1 : o.measureNumbers === 'five' ? 5 : 0,
    justifyVertically: o.justifyVertically,
    minLastJustification: 0.6,
    ...spacing,
  };
}

/** MEI `<pgHead>` / `<pgFoot>` elements for the first and following pages. */
export function buildPageHeadersMei(o: SheetExportOptions): string {
  const e = escapeXml;
  const first: string[] = [];
  if (o.title) first.push(`<rend halign="center" valign="top"><rend fontsize="xx-large">${e(o.title)}</rend></rend>`);
  if (o.subtitle) first.push(`<rend halign="center" valign="top"><rend fontsize="large">${e(o.subtitle)}</rend></rend>`);
  if (o.arranger)
    first.push(`<rend halign="left" valign="bottom"><rend fontstyle="italic">${e(o.arranger)}</rend></rend>`);
  if (o.composer) first.push(`<rend halign="right" valign="bottom">${e(o.composer)}</rend>`);
  const out: string[] = [];
  out.push(`<pgHead func="first">${first.join('')}</pgHead>`);
  const footFirst = o.copyright
    ? `<rend halign="center" valign="bottom"><rend fontsize="small">${e(o.copyright)}</rend></rend>`
    : '';
  out.push(`<pgFoot func="first">${footFirst}</pgFoot>`);
  const running =
    o.runningTitle && o.title
      ? `<rend halign="left" valign="top"><rend fontsize="small" fontstyle="italic">${e(o.title)}</rend></rend>`
      : '';
  out.push(`<pgHead func="all">${running}</pgHead>`);
  const pageNo = o.pageNumbers ? '<rend halign="center" valign="bottom"><num label="page">#</num></rend>' : '';
  out.push(`<pgFoot func="all">${pageNo}</pgFoot>`);
  return out.join('');
}

/** Replaces any page headers in an MEI document with the given ones. */
export function injectPageHeaders(mei: string, headers: string): string {
  const cleaned = mei.replace(/<pgHead[\s\S]*?<\/pgHead>/g, '').replace(/<pgFoot[\s\S]*?<\/pgFoot>/g, '').replace(/<pg(Head|Foot)[^>]*\/>/g, '');
  return cleaned.replace(/(<scoreDef\b[^>]*>)/, `$1${headers}`);
}
