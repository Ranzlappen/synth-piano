import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileDown, FileText, RotateCcw, Wand2 } from 'lucide-react';
import {
  analyzePerformance,
  buildSheetMusic,
  DEFAULT_SHEET_OPTIONS,
  ENGRAVING_FONTS,
  PAPER_SIZES,
  resolveSheetOptions,
  sanitizeSheetOptions,
  type PaperSize,
  type SheetExportOptions,
  type SheetMusicJob,
} from '@core/notation';
import { KEY_NAMES_MAJOR, KEY_NAMES_MINOR, noteName, tempoTerm } from '@core/music';
import { api } from '../../platform';
import { engraver, SupersededError } from '../../sheet/engraver';
import { useProject } from '../../state/project';
import { useUi } from '../../state/ui';
import { safeName } from '../../files';
import { Dialog } from './Dialog';

const TEMPO_WORDS = [
  '',
  'Largo',
  'Adagio',
  'Andante',
  'Moderato',
  'Allegretto',
  'Allegro',
  'Vivace',
  'Presto',
  'Rubato',
  'Swing',
  'Ballad',
  'Freely',
];
const TRANSPOSE_PRESETS = [
  { value: 0, label: 'Concert pitch (no transposition)' },
  { value: 2, label: 'B♭ instruments (+2: trumpet, clarinet, tenor sax)' },
  { value: 9, label: 'E♭ alto / baritone sax (+9)' },
  { value: 7, label: 'F horn (+7)' },
  { value: 12, label: 'Octave up (+12)' },
  { value: -12, label: 'Octave down (−12)' },
];

type Status = { state: 'idle' | 'busy' | 'ready' } | { state: 'error'; message: string };

function Section({
  title,
  open,
  children,
}: {
  title: string;
  open?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details open={open}>
      <summary>
        <ChevronRight />
        {title}
      </summary>
      <div className="form">{children}</div>
    </details>
  );
}

export function SheetExportDialog(): React.JSX.Element {
  const project = useProject((s) => s.project);
  const [opts, setOpts] = useState<SheetExportOptions>(() =>
    resolveSheetOptions(project, project.sheetExport as Partial<SheetExportOptions> | undefined),
  );
  const [job, setJob] = useState<SheetMusicJob | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [zoom, setZoom] = useState(0.9);
  const [engraverVersion, setEngraverVersion] = useState('');
  const [openAfter, setOpenAfter] = useState(true);
  const [exporting, setExporting] = useState(false);
  const renderPromise = useRef<Promise<void> | null>(null);

  const set = <K extends keyof SheetExportOptions>(key: K, value: SheetExportOptions[K]) =>
    setOpts((o) => sanitizeSheetOptions({ ...o, [key]: value }));

  // Re-engrave (debounced) whenever the options change.
  useEffect(() => {
    setStatus({ state: 'busy' });
    const timer = setTimeout(() => {
      let built: SheetMusicJob;
      try {
        built = buildSheetMusic(project, opts, `Synth Piano`);
      } catch (err) {
        setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
        return;
      }
      setJob(built);
      renderPromise.current = engraver
        .render({ musicxml: built.musicxml, options: built.verovioOptions, headers: built.pageHeaders })
        .then((r) => {
          setPages(r.pages);
          setEngraverVersion(r.version);
          setStatus({ state: 'ready' });
        })
        .catch((err) => {
          if (err instanceof SupersededError) return;
          setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) });
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [opts, project]);

  const persist = () =>
    useProject.setState((s) => ({ project: { ...s.project, sheetExport: { ...opts } }, dirty: true }));

  const fileBase = safeName(opts.title || project.meta.title || 'Sheet music');

  const exportPdf = async () => {
    if (!job) return;
    setExporting(true);
    try {
      await renderPromise.current;
      persist();
      const saved = await api.exportPdf({
        pages,
        widthMm: job.geometry.widthMm,
        heightMm: job.geometry.heightMm,
        suggestedName: `${fileBase}.pdf`,
        title: opts.title || fileBase,
        openAfterExport: openAfter,
      });
      if (saved)
        useUi.getState().toast({
          kind: 'success',
          text: api.isElectron
            ? `PDF saved: ${saved.split(/[\\/]/).pop()}`
            : 'Opened the print dialog — choose “Save as PDF”.',
        });
    } catch (err) {
      useUi.getState().toast({
        kind: 'error',
        text: `PDF export failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setExporting(false);
    }
  };

  const exportXml = async () => {
    if (!job) return;
    persist();
    const saved = await api.saveFile({
      suggestedName: `${fileBase}.musicxml`,
      kind: 'musicxml',
      data: job.musicxml,
    });
    if (saved)
      useUi.getState().toast({ kind: 'success', text: `MusicXML saved: ${saved.split(/[\\/]/).pop()}` });
  };

  const detectTempo = () => {
    const est = analyzePerformance(project, opts);
    if (!est) {
      useUi.getState().toast({ kind: 'warning', text: 'Not enough notes to estimate the tempo.' });
      return;
    }
    setOpts((o) =>
      sanitizeSheetOptions({
        ...o,
        timing: 'free',
        performanceBpm: est.bpm,
        performanceOffsetSec: Math.round(est.offsetSec * 1000) / 1000,
      }),
    );
    useUi.getState().toast({
      kind: est.confidence > 0.55 ? 'success' : 'warning',
      text: `Estimated ${est.bpm} BPM, first beat at ${est.offsetSec.toFixed(2)} s${est.confidence > 0.55 ? '' : ' (low confidence — check the preview)'}.`,
    });
  };

  const tracksWithNotes = project.tracks.filter((t) => t.notes.length > 0);
  const stats = job?.stats;
  const paperPx = useMemo(() => {
    if (!job) return { w: 595, h: 842 };
    const pxPerMm = 3.2 * zoom;
    return { w: job.geometry.widthMm * pxPerMm, h: job.geometry.heightMm * pxPerMm };
  }, [job, zoom]);

  const splitOptions = Array.from({ length: 49 }, (_, i) => 36 + i);
  const keyOptions = Array.from({ length: 15 }, (_, i) => i - 7);

  return (
    <Dialog
      title="Export sheet music"
      wide
      onClose={() => useUi.getState().openDialog(null)}
      footer={
        <>
          <div className="left">
            <label className="check">
              <input type="checkbox" checked={openAfter} onChange={(e) => setOpenAfter(e.target.checked)} />
              Open PDF after export
            </label>
          </div>
          <button className="btn" onClick={() => useUi.getState().openDialog(null)}>
            Close
          </button>
          <button
            className="btn"
            onClick={exportXml}
            disabled={!job}
            title="For MuseScore, Dorico, Finale, Sibelius …"
          >
            <FileText /> MusicXML…
          </button>
          <button
            className="btn primary"
            onClick={exportPdf}
            disabled={!job || status.state === 'error' || exporting}
            data-testid="export-pdf"
          >
            <FileDown /> {exporting ? 'Exporting…' : 'Export PDF…'}
          </button>
        </>
      }
    >
      <div className="export">
        <div className="export-options">
          <Section title="Score information" open>
            <label>Title</label>
            <input
              type="text"
              value={opts.title}
              placeholder="Untitled"
              onChange={(e) => set('title', e.target.value)}
            />
            <label>Subtitle</label>
            <input type="text" value={opts.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
            <label>Composer</label>
            <input type="text" value={opts.composer} onChange={(e) => set('composer', e.target.value)} />
            <label>Arranger / lyricist</label>
            <input
              type="text"
              value={opts.arranger}
              placeholder="e.g. Arr. by …"
              onChange={(e) => set('arranger', e.target.value)}
            />
            <label>Copyright</label>
            <input
              type="text"
              value={opts.copyright}
              placeholder="© 2026 …"
              onChange={(e) => set('copyright', e.target.value)}
            />
            <label>Instrument</label>
            <div className="inline">
              <input
                type="text"
                value={opts.instrumentName}
                onChange={(e) => set('instrumentName', e.target.value)}
              />
              <label className="check" title="Print the instrument name before the first system">
                <input
                  type="checkbox"
                  checked={opts.showInstrumentName}
                  onChange={(e) => set('showInstrumentName', e.target.checked)}
                />
                show
              </label>
            </div>
          </Section>

          <Section title="Tempo, meter & key" open>
            <label>Timing</label>
            <select
              value={opts.timing}
              onChange={(e) => set('timing', e.target.value as SheetExportOptions['timing'])}
            >
              <option value="project">Recorded to the metronome (use project bars)</option>
              <option value="free">Played freely (re-time with the tempo below)</option>
            </select>
            {opts.timing === 'free' && (
              <>
                <label>Played at (BPM)</label>
                <div className="inline">
                  <input
                    type="number"
                    min={20}
                    max={400}
                    step={0.5}
                    value={opts.performanceBpm}
                    onChange={(e) => set('performanceBpm', Number(e.target.value))}
                  />
                  <button
                    className="btn small"
                    onClick={detectTempo}
                    title="Estimate tempo and first beat from the performance"
                  >
                    <Wand2 /> Detect
                  </button>
                </div>
                <label>Music starts at (s)</label>
                <input
                  type="number"
                  step={0.01}
                  value={opts.performanceOffsetSec}
                  onChange={(e) => set('performanceOffsetSec', Number(e.target.value))}
                />
              </>
            )}
            {opts.timing === 'project' && (
              <div className="full hint">
                Not recorded with the metronome? Choose “Played freely” and press Detect to estimate the tempo
                of your performance.
              </div>
            )}
            <label>Note values</label>
            <select
              value={opts.durationScale}
              onChange={(e) => set('durationScale', Number(e.target.value) as 0.5 | 1 | 2)}
            >
              <option value={1}>As played</option>
              <option value={0.5}>Double time (halve note values)</option>
              <option value={2}>Half time (double note values)</option>
            </select>
            <label>Time signature</label>
            <select value={opts.timeSignature} onChange={(e) => set('timeSignature', e.target.value)}>
              <option value="project">From project</option>
              {['2/4', '3/4', '4/4', '5/4', '6/4', '2/2', '3/2', '3/8', '6/8', '9/8', '12/8'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <label>Pickup bar</label>
            <div className="inline">
              <input
                type="number"
                min={0}
                max={8}
                step={0.5}
                value={opts.pickupBeats}
                onChange={(e) => set('pickupBeats', Number(e.target.value))}
              />
              <span className="muted">beats</span>
              {stats && stats.suggestedPickup > 0 && opts.pickupBeats === 0 && (
                <button
                  className="btn small"
                  onClick={() => set('pickupBeats', stats.suggestedPickup)}
                  title="The music starts late in the first bar"
                >
                  Use {stats.suggestedPickup}
                </button>
              )}
            </div>
            <label>Key signature</label>
            <div className="inline">
              <select
                value={opts.keyMode}
                onChange={(e) => set('keyMode', e.target.value as SheetExportOptions['keyMode'])}
              >
                <option value="auto">Detect</option>
                <option value="project">From project</option>
                <option value="manual">Choose…</option>
              </select>
              {opts.keyMode === 'manual' && (
                <select
                  value={`${opts.keyFifths}:${opts.keyMinor ? 'm' : 'M'}`}
                  onChange={(e) => {
                    const [f, m] = e.target.value.split(':');
                    setOpts((o) => sanitizeSheetOptions({ ...o, keyFifths: Number(f), keyMinor: m === 'm' }));
                  }}
                >
                  {keyOptions.map((f) => (
                    <option key={`${f}M`} value={`${f}:M`}>
                      {KEY_NAMES_MAJOR[f]}
                    </option>
                  ))}
                  {keyOptions.map((f) => (
                    <option key={`${f}m`} value={`${f}:m`}>
                      {KEY_NAMES_MINOR[f]}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <label>Tempo mark</label>
            <div className="inline">
              <label className="check">
                <input
                  type="checkbox"
                  checked={opts.showTempo}
                  onChange={(e) => set('showTempo', e.target.checked)}
                />
                show
              </label>
              <input
                type="text"
                list="tempo-words"
                value={opts.tempoText}
                placeholder={stats ? tempoTerm(stats.tempoBpm) : 'Allegro'}
                onChange={(e) => set('tempoText', e.target.value)}
              />
              <datalist id="tempo-words">
                {TEMPO_WORDS.filter(Boolean).map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
            </div>
            <label>Printed BPM</label>
            <div className="inline">
              <input
                type="number"
                min={0}
                max={400}
                value={opts.tempoBpmOverride || ''}
                placeholder={stats ? String(Math.round(stats.tempoBpm)) : 'auto'}
                onChange={(e) => set('tempoBpmOverride', Number(e.target.value) || 0)}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={opts.showTempoChanges}
                  onChange={(e) => set('showTempoChanges', e.target.checked)}
                />
                tempo changes
              </label>
            </div>
          </Section>

          <Section title="Content">
            <label>Tracks</label>
            <div style={{ display: 'grid', gap: 4 }}>
              {tracksWithNotes.length === 0 && <span className="muted">No tracks with notes.</span>}
              {tracksWithNotes.map((t) => {
                const all = opts.trackIds.length === 0;
                const checked = all || opts.trackIds.includes(t.id);
                return (
                  <label key={t.id} className="check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const current = all ? tracksWithNotes.map((x) => x.id) : opts.trackIds;
                        const next = e.target.checked
                          ? [...current, t.id]
                          : current.filter((id) => id !== t.id);
                        set('trackIds', next.length === tracksWithNotes.length ? [] : next);
                      }}
                    />
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color }} />
                    {t.name}
                    <span className="muted">({t.notes.length})</span>
                  </label>
                );
              })}
            </div>
            <label>Layout of tracks</label>
            <select
              value={opts.partMode}
              onChange={(e) => set('partMode', e.target.value as SheetExportOptions['partMode'])}
            >
              <option value="combined">Combine into one instrument</option>
              <option value="separate">One instrument per track</option>
            </select>
            <label>Bars</label>
            <div className="inline">
              <input
                type="number"
                min={1}
                value={opts.fromBar}
                onChange={(e) => set('fromBar', Number(e.target.value))}
              />
              <span className="muted">to</span>
              <input
                type="number"
                min={0}
                value={opts.toBar || ''}
                placeholder="end"
                onChange={(e) => set('toBar', Number(e.target.value) || 0)}
              />
            </div>
            <label />
            <label className="check">
              <input
                type="checkbox"
                checked={opts.skipLeadingEmptyBars}
                onChange={(e) => set('skipLeadingEmptyBars', e.target.checked)}
              />
              Skip empty bars at the start (count-in)
            </label>
            <label>Transpose</label>
            <select
              value={TRANSPOSE_PRESETS.some((p) => p.value === opts.transpose) ? opts.transpose : 'custom'}
              onChange={(e) => e.target.value !== 'custom' && set('transpose', Number(e.target.value))}
            >
              {TRANSPOSE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
              {!TRANSPOSE_PRESETS.some((p) => p.value === opts.transpose) && (
                <option value="custom">
                  Custom ({opts.transpose > 0 ? '+' : ''}
                  {opts.transpose})
                </option>
              )}
            </select>
            <label>Semitones</label>
            <input
              type="number"
              min={-36}
              max={36}
              value={opts.transpose}
              onChange={(e) => set('transpose', Number(e.target.value))}
            />
          </Section>

          <Section title="Rhythm & quantisation">
            <label>Shortest note</label>
            <select
              value={opts.grid}
              onChange={(e) => set('grid', Number(e.target.value) as SheetExportOptions['grid'])}
            >
              <option value={4}>Quarter notes</option>
              <option value={8}>Eighth notes</option>
              <option value={16}>Sixteenth notes</option>
              <option value={32}>Thirty-second notes</option>
            </select>
            <label />
            <label className="check">
              <input
                type="checkbox"
                checked={opts.triplets}
                onChange={(e) => set('triplets', e.target.checked)}
              />
              Detect triplets
            </label>
            <label />
            <label className="check" title="Long-short eighths are written as straight eighths">
              <input type="checkbox" checked={opts.swing} onChange={(e) => set('swing', e.target.checked)} />
              Swing feel → straight eighths
            </label>
            <label>Note lengths</label>
            <select
              value={opts.durations}
              onChange={(e) => set('durations', e.target.value as SheetExportOptions['durations'])}
            >
              <option value="clean">Clean (close small gaps)</option>
              <option value="exact">Exactly as played</option>
              <option value="legato">Legato (hold to next note)</option>
            </select>
            <label>Ignore notes under</label>
            <div className="inline">
              <input
                type="number"
                min={0}
                max={500}
                value={opts.minNoteMs}
                onChange={(e) => set('minNoteMs', Number(e.target.value))}
              />
              <span className="muted">ms</span>
            </div>
            <label />
            <label
              className="check"
              title="Notes released while the sustain pedal is down are written until the pedal is released"
            >
              <input
                type="checkbox"
                checked={opts.extendUnderPedal}
                onChange={(e) => set('extendUnderPedal', e.target.checked)}
              />
              Lengthen notes held by the pedal
            </label>
          </Section>

          <Section title="Staves & voices">
            <label>Staves</label>
            <select
              value={opts.staffMode}
              onChange={(e) => set('staffMode', e.target.value as SheetExportOptions['staffMode'])}
            >
              <option value="auto">Automatic</option>
              <option value="grand">Grand staff (piano)</option>
              <option value="treble">Treble clef only</option>
              <option value="bass">Bass clef only</option>
            </select>
            <label>Hand split</label>
            <select
              value={opts.handSplit}
              onChange={(e) => set('handSplit', e.target.value as SheetExportOptions['handSplit'])}
            >
              <option value="smart">Smart (follow the hands)</option>
              <option value="fixed">Fixed split point</option>
            </select>
            <label>Split point</label>
            <select value={opts.splitPoint} onChange={(e) => set('splitPoint', Number(e.target.value))}>
              {splitOptions.map((p) => (
                <option key={p} value={p}>
                  {noteName(p)}
                  {p === 60 ? ' (middle C)' : ''}
                </option>
              ))}
            </select>
            <label>Voices per staff</label>
            <select value={opts.voices} onChange={(e) => set('voices', Number(e.target.value) as 1 | 2)}>
              <option value={2}>Up to 2 (held notes under moving lines)</option>
              <option value={1}>1 (simplest, chords only)</option>
            </select>
          </Section>

          <Section title="Dynamics & expression">
            <label />
            <label className="check">
              <input
                type="checkbox"
                checked={opts.dynamics}
                onChange={(e) => set('dynamics', e.target.checked)}
              />
              Dynamics (pp … ff) from velocity
            </label>
            <label>Sensitivity</label>
            <select
              value={opts.dynamicsSensitivity}
              disabled={!opts.dynamics}
              onChange={(e) =>
                set('dynamicsSensitivity', e.target.value as SheetExportOptions['dynamicsSensitivity'])
              }
            >
              <option value="low">Low (few marks)</option>
              <option value="medium">Medium</option>
              <option value="high">High (every change)</option>
            </select>
            <label />
            <label className="check">
              <input
                type="checkbox"
                checked={opts.hairpins}
                onChange={(e) => set('hairpins', e.target.checked)}
              />
              Crescendo / diminuendo hairpins
            </label>
            <label>Sustain pedal</label>
            <select
              value={opts.pedal}
              onChange={(e) => set('pedal', e.target.value as SheetExportOptions['pedal'])}
            >
              <option value="symbols">Ped. / ✱ symbols</option>
              <option value="lines">Pedal brackets</option>
              <option value="none">Not shown</option>
            </select>
            <label />
            <label className="check">
              <input
                type="checkbox"
                checked={opts.softPedal}
                onChange={(e) => set('softPedal', e.target.checked)}
              />
              Soft pedal (una corda / tre corde)
            </label>
            <label />
            <label className="check">
              <input
                type="checkbox"
                checked={opts.staccato}
                onChange={(e) => set('staccato', e.target.checked)}
              />
              Staccato for short detached notes
            </label>
            <label />
            <label className="check">
              <input
                type="checkbox"
                checked={opts.accents}
                onChange={(e) => set('accents', e.target.checked)}
              />
              Accents for strongly emphasised notes
            </label>
          </Section>

          <Section title="Page layout">
            <label>Paper</label>
            <div className="inline">
              <select value={opts.paper} onChange={(e) => set('paper', e.target.value as PaperSize)}>
                {Object.entries(PAPER_SIZES).map(([id, p]) => (
                  <option key={id} value={id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <label>Orientation</label>
            <select
              value={opts.landscape ? 'l' : 'p'}
              onChange={(e) => set('landscape', e.target.value === 'l')}
            >
              <option value="p">Portrait</option>
              <option value="l">Landscape</option>
            </select>
            <label>Staff size</label>
            <select value={opts.staffSizeMm} onChange={(e) => set('staffSizeMm', Number(e.target.value))}>
              {[5, 5.5, 6, 6.5, 7, 7.5, 8, 9].map((s) => (
                <option key={s} value={s}>
                  {s} mm{s === 7 ? ' (standard)' : s <= 5.5 ? ' (compact)' : s >= 8 ? ' (large print)' : ''}
                </option>
              ))}
            </select>
            <label>Margins (mm)</label>
            <div className="inline">
              <input
                type="number"
                min={0}
                max={60}
                value={opts.marginTopMm}
                title="Top"
                onChange={(e) => set('marginTopMm', Number(e.target.value))}
                style={{ width: 56 }}
              />
              <input
                type="number"
                min={0}
                max={60}
                value={opts.marginBottomMm}
                title="Bottom"
                onChange={(e) => set('marginBottomMm', Number(e.target.value))}
                style={{ width: 56 }}
              />
              <input
                type="number"
                min={0}
                max={60}
                value={opts.marginSideMm}
                title="Left / right"
                onChange={(e) => set('marginSideMm', Number(e.target.value))}
                style={{ width: 56 }}
              />
            </div>
            <label>Bars per line</label>
            <input
              type="number"
              min={0}
              max={16}
              value={opts.measuresPerSystem || ''}
              placeholder="auto"
              onChange={(e) => set('measuresPerSystem', Number(e.target.value) || 0)}
            />
            <label>Lines per page</label>
            <input
              type="number"
              min={0}
              max={20}
              value={opts.systemsPerPage || ''}
              placeholder="auto"
              onChange={(e) => set('systemsPerPage', Number(e.target.value) || 0)}
            />
            <label>Bar numbers</label>
            <select
              value={opts.measureNumbers}
              onChange={(e) => set('measureNumbers', e.target.value as SheetExportOptions['measureNumbers'])}
            >
              <option value="system">At the start of each line</option>
              <option value="every">Every bar</option>
              <option value="five">Every 5 bars</option>
              <option value="none">None</option>
            </select>
            <label>Spacing</label>
            <select
              value={opts.spacing}
              onChange={(e) => set('spacing', e.target.value as SheetExportOptions['spacing'])}
            >
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="spacious">Spacious</option>
            </select>
            <label>Music font</label>
            <select
              value={opts.font}
              onChange={(e) => set('font', e.target.value as SheetExportOptions['font'])}
            >
              {ENGRAVING_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <label />
            <label className="check">
              <input
                type="checkbox"
                checked={opts.justifyVertically}
                onChange={(e) => set('justifyVertically', e.target.checked)}
              />
              Spread lines over the full page
            </label>
            <label />
            <label className="check">
              <input
                type="checkbox"
                checked={opts.pageNumbers}
                onChange={(e) => set('pageNumbers', e.target.checked)}
              />
              Page numbers
            </label>
            <label />
            <label className="check">
              <input
                type="checkbox"
                checked={opts.runningTitle}
                onChange={(e) => set('runningTitle', e.target.checked)}
              />
              Title on following pages
            </label>
          </Section>
          <div style={{ paddingTop: 10 }}>
            <button
              className="btn small"
              onClick={() =>
                setOpts(
                  resolveSheetOptions(project, {
                    ...DEFAULT_SHEET_OPTIONS,
                    title: opts.title,
                    composer: opts.composer,
                  }),
                )
              }
            >
              <RotateCcw /> Reset to defaults
            </button>
          </div>
        </div>

        <div className="preview">
          <div className="preview-bar">
            {status.state === 'busy' && (
              <span className="busy">
                <span className="spinner" /> Engraving…
              </span>
            )}
            {status.state === 'ready' && (
              <span>
                {pages.length} page{pages.length === 1 ? '' : 's'}
              </span>
            )}
            {status.state === 'error' && <span style={{ color: 'var(--danger)' }}>{status.message}</span>}
            <span style={{ flex: 1 }} />
            Zoom
            <input
              type="range"
              min={0.4}
              max={1.8}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <span style={{ width: 40 }}>{Math.round(zoom * 100)}%</span>
          </div>
          <div className="preview-pages" data-testid="sheet-preview">
            {pages.map((svg, i) => (
              <div key={i} className="paper" style={{ width: paperPx.w, height: paperPx.h }}>
                <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: svg }} />
                <span className="page-no">{i + 1}</span>
              </div>
            ))}
            {pages.length === 0 && status.state !== 'busy' && (
              <div className="muted">Nothing to show yet.</div>
            )}
          </div>
          {stats && (
            <div className="stats">
              <span>
                <b>{stats.measures}</b> bars
              </span>
              <span>
                <b>{stats.notes}</b> notes
              </span>
              <span>Key: {stats.keyName}</span>
              <span>Tempo: ♩ = {Math.round(stats.tempoBpm)}</span>
              {engraverVersion && (
                <span className="muted">Engraved with Verovio {engraverVersion.split('-')[0]}</span>
              )}
              {stats.warnings.map((w) => (
                <span key={w} className="warn">
                  ⚠ {w}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
