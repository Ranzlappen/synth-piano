// Serialises the notated score model as MusicXML 4.0 (partwise). The output is used for
// PDF engraving (via Verovio) and can be opened directly in MuseScore, Dorico, Finale, …

import { DYNAMIC_LEVELS, GM_PROGRAMS } from '../music';
import type { SheetExportOptions } from './options';
import type { NDirection, NEvent, NMeasureInfo, NPart, NScore, NVoice } from './transcribe';

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface MusicXmlOptions {
  software: string;
  measureNumbers: SheetExportOptions['measureNumbers'];
  /** General MIDI program per part id, for playback in other applications. */
  programs?: Record<string, number>;
  date?: Date;
}

export function toMusicXml(score: NScore, opts: MusicXmlOptions): string {
  const out: string[] = [];
  const w = (line: string) => out.push(line);
  const date = (opts.date ?? new Date()).toISOString().slice(0, 10);

  w('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  w(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  );
  w('<score-partwise version="4.0">');
  if (score.title) w(`  <work><work-title>${escapeXml(score.title)}</work-title></work>`);
  w('  <identification>');
  if (score.composer) w(`    <creator type="composer">${escapeXml(score.composer)}</creator>`);
  if (score.arranger) w(`    <creator type="arranger">${escapeXml(score.arranger)}</creator>`);
  if (score.copyright) w(`    <rights>${escapeXml(score.copyright)}</rights>`);
  w('    <encoding>');
  w(`      <software>${escapeXml(opts.software)}</software>`);
  w(`      <encoding-date>${date}</encoding-date>`);
  w('      <supports element="accidental" type="no"/>');
  w('      <supports element="beam" type="yes"/>');
  w('      <supports element="stem" type="no"/>');
  w('    </encoding>');
  w('  </identification>');
  const credit = (type: string, text: string, justify: string, valign: string, size: number) =>
    w(
      `  <credit page="1"><credit-type>${type}</credit-type><credit-words justify="${justify}" valign="${valign}" font-size="${size}">${escapeXml(text)}</credit-words></credit>`,
    );
  if (score.title) credit('title', score.title, 'center', 'top', 22);
  if (score.subtitle) credit('subtitle', score.subtitle, 'center', 'top', 14);
  if (score.composer) credit('composer', score.composer, 'right', 'bottom', 11);
  if (score.arranger) credit('arranger', score.arranger, 'left', 'bottom', 11);
  if (score.copyright) credit('rights', score.copyright, 'center', 'bottom', 8);

  w('  <part-list>');
  score.parts.forEach((p, i) => {
    const program = opts.programs?.[p.id] ?? 0;
    w(`    <score-part id="P${i + 1}">`);
    w(`      <part-name${score.showInstrumentNames ? '' : ' print-object="no"'}>${escapeXml(p.name)}</part-name>`);
    w(`      <score-instrument id="P${i + 1}-I1"><instrument-name>${escapeXml(GM_PROGRAMS[program] ?? p.name)}</instrument-name></score-instrument>`);
    // Skip channel 10 (drums) when numbering channels.
    const channel = ((i >= 9 ? i + 1 : i) % 16) + 1;
    w(
      `      <midi-instrument id="P${i + 1}-I1"><midi-channel>${channel}</midi-channel><midi-program>${program + 1}</midi-program></midi-instrument>`,
    );
    w('    </score-part>');
  });
  w('  </part-list>');

  score.parts.forEach((part, pi) => {
    w(`  <part id="P${pi + 1}">`);
    score.measures.forEach((m, mi) => writeMeasure(w, score, part, m, mi, opts));
    w('  </part>');
  });
  w('</score-partwise>');
  return out.join('\n') + '\n';
}

function writeMeasure(
  w: (s: string) => void,
  score: NScore,
  part: NPart,
  m: NMeasureInfo,
  mi: number,
  opts: MusicXmlOptions,
): void {
  const pm = part.measures[mi];
  const last = mi === score.measures.length - 1;
  w(`    <measure number="${m.implicit ? 0 : m.number}"${m.implicit ? ' implicit="yes"' : ''}>`);
  if (mi === 0 && opts.measureNumbers === 'none') w('      <print><measure-numbering>none</measure-numbering></print>');
  else if (m.newSystem) w('      <print new-system="yes"/>');

  const attrs: string[] = [];
  if (mi === 0) attrs.push(`<divisions>${score.divisions}</divisions>`);
  if (m.showKey) attrs.push(`<key><fifths>${m.keyFifths}</fifths><mode>${m.keyMinor ? 'minor' : 'major'}</mode></key>`);
  if (m.showMeter) attrs.push(`<time><beats>${m.meter.numerator}</beats><beat-type>${m.meter.denominator}</beat-type></time>`);
  if (mi === 0) {
    if (part.staves > 1) attrs.push(`<staves>${part.staves}</staves>`);
    part.clefs.forEach((c, i) =>
      attrs.push(
        `<clef${part.staves > 1 ? ` number="${i + 1}"` : ''}><sign>${c === 'bass' ? 'F' : 'G'}</sign><line>${c === 'bass' ? 4 : 2}</line></clef>`,
      ),
    );
  }
  if (attrs.length) w(`      <attributes>${attrs.join('')}</attributes>`);

  for (const d of pm.directions) w(`      ${direction(d, part.staves)}`);

  const voices = [...pm.voices].sort((a, b) => a.staff - b.staff || a.voice - b.voice);
  if (voices.length === 0) {
    // Defensive: an empty measure still needs content.
    w(`      <note><rest measure="yes"/><duration>${m.length}</duration><voice>1</voice></note>`);
  }
  voices.forEach((v, i) => {
    if (i > 0) w(`      <backup><duration>${m.length}</duration></backup>`);
    for (const e of v.events) writeEvent(w, e, v, part.staves);
  });
  if (last) w('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
  w('    </measure>');
}

function writeEvent(w: (s: string) => void, e: NEvent, v: NVoice, staves: number): void {
  const common = (): string => `<duration>${e.value.duration}</duration>`;
  const tail = (isFirst: boolean, tieStart: boolean, tieStop: boolean): string => {
    let s = `<voice>${v.voice}</voice>`;
    if (!e.measureRest) s += `<type>${e.value.type}</type>`;
    for (let i = 0; i < e.value.dots; i++) s += '<dot/>';
    if (e.value.triplet) s += '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
    if (!e.rest && v.stem) s += `<stem>${v.stem}</stem>`;
    if (staves > 1) s += `<staff>${v.staff}</staff>`;
    if (isFirst && e.beam) s += `<beam number="1">${e.beam}</beam>`;
    const notations: string[] = [];
    if (tieStop) notations.push('<tied type="stop"/>');
    if (tieStart) notations.push('<tied type="start"/>');
    if (isFirst && e.tuplet) {
      notations.push(
        e.tuplet === 'start' ? `<tuplet type="start" bracket="${e.tupletBracket ? 'yes' : 'no'}"/>` : '<tuplet type="stop"/>',
      );
    }
    if (isFirst && e.articulations.length) notations.push(`<articulations>${e.articulations.map((a) => `<${a}/>`).join('')}</articulations>`);
    if (notations.length) s += `<notations>${notations.join('')}</notations>`;
    return s;
  };
  if (e.rest) {
    w(`      <note>${e.measureRest ? '<rest measure="yes"/>' : '<rest/>'}${common()}${tail(true, false, false)}</note>`);
    return;
  }
  e.pitches.forEach((p, i) => {
    const pitch = `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`;
    const ties = `${p.tieStop ? '<tie type="stop"/>' : ''}${p.tieStart ? '<tie type="start"/>' : ''}`;
    w(`      <note>${i > 0 ? '<chord/>' : ''}${pitch}${common()}${ties}${tail(i === 0, p.tieStart, p.tieStop)}</note>`);
  });
}

function direction(d: NDirection, staves: number): string {
  const offset = d.offset > 0 ? `<offset>${Math.round(d.offset)}</offset>` : '';
  const staff = staves > 1 ? `<staff>${d.staff}</staff>` : '';
  switch (d.kind) {
    case 'dynamic': {
      const level = DYNAMIC_LEVELS.find((l) => l.mark === d.mark);
      const sound = level ? `<sound dynamics="${Math.round((level.velocity / 90) * 100)}"/>` : '';
      return `<direction placement="below"><direction-type><dynamics><${d.mark}/></dynamics></direction-type>${offset}${staff}${sound}</direction>`;
    }
    case 'wedge':
      return `<direction placement="below"><direction-type><wedge type="${d.type}"/></direction-type>${offset}${staff}</direction>`;
    case 'pedal':
      return `<direction placement="below"><direction-type><pedal type="${d.type}" line="${d.line ? 'yes' : 'no'}" sign="${d.line ? 'no' : 'yes'}"/></direction-type>${offset}${staff}</direction>`;
    case 'words':
      return `<direction placement="${d.placement}"><direction-type><words${d.italic ? ' font-style="italic"' : ''}>${escapeXml(d.text)}</words></direction-type>${offset}${staff}</direction>`;
    case 'tempo': {
      const words = d.text ? `<direction-type><words font-weight="bold">${escapeXml(d.text)}&#160;</words></direction-type>` : '';
      const metronome = d.showMetronome
        ? `<direction-type><metronome parentheses="no"><beat-unit>${d.unit}</beat-unit>${d.dotted ? '<beat-unit-dot/>' : ''}<per-minute>${d.perMinute}</per-minute></metronome></direction-type>`
        : '';
      return `<direction placement="above">${words}${metronome}${offset}${staff}<sound tempo="${Math.round(d.quarterBpm * 100) / 100}"/></direction>`;
    }
  }
}
