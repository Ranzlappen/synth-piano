import { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { TrackList } from './components/TrackList';
import { PianoRoll } from './components/pianoroll/PianoRoll';
import { ControllerPanel } from './components/controller/ControllerPanel';
import { StatusBar } from './components/StatusBar';
import { Toasts } from './components/Toasts';
import { ConfirmDialog } from './components/dialogs/ConfirmDialog';
import { SheetExportDialog } from './components/dialogs/SheetExportDialog';
import { MidiSettingsDialog } from './components/dialogs/MidiSettingsDialog';
import { PreferencesDialog } from './components/dialogs/PreferencesDialog';
import { QuantizeDialog } from './components/dialogs/QuantizeDialog';
import { ProjectInfoDialog } from './components/dialogs/ProjectInfoDialog';
import { ShortcutsDialog } from './components/dialogs/ShortcutsDialog';
import { AboutDialog } from './components/dialogs/AboutDialog';
import { engine } from './engine/engine';
import { checkUpdates, runCommand } from './commands';
import { confirmDiscard, offerAutosaveRestore, openOpenedFile, projectTitle, startAutosave } from './files';
import { useKeyboard } from './hooks/useKeyboard';
import { api } from './platform';
import { useProject } from './state/project';
import { useSettings } from './state/settings';
import { useUi } from './state/ui';

export function App(): React.JSX.Element {
  const showController = useUi((s) => s.showController);
  const dialog = useUi((s) => s.dialog);
  const theme = useSettings((s) => s.theme);
  const autosaveMinutes = useSettings((s) => s.autosaveMinutes);
  useKeyboard();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => startAutosave(autosaveMinutes), [autosaveMinutes]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      await useSettings.getState().load();
      if (disposed) return;
      engine.init();
      await offerAutosaveRestore();
      const info = await api.getAppInfo();
      if (info.isPackaged && useSettings.getState().checkUpdates)
        setTimeout(() => void checkUpdates(true), 4000);
    })();
    const offs = [
      api.onMenuCommand(runCommand),
      api.onOpenFile(async (file) => {
        if (await confirmDiscard()) await openOpenedFile(file);
      }),
      api.onCloseRequested(async () => {
        engine.stop(false);
        if (await confirmDiscard()) api.closeWindow();
      }),
      api.onUpdateStatus((status) => {
        if (status.state === 'downloaded')
          useUi.getState().toast({
            kind: 'success',
            text: `Update ${status.version} is ready.`,
            timeout: 0,
            action: { label: 'Restart now', run: () => api.installUpdate() },
          });
        if (status.state === 'error')
          useUi.getState().toast({ kind: 'error', text: `Update failed: ${status.message}` });
      }),
    ];
    // Window title and unsaved-changes protection.
    const pushState = () =>
      api.setDocumentState({ title: projectTitle(), dirty: useProject.getState().dirty });
    pushState();
    const unsub = useProject.subscribe((s, prev) => {
      if (
        s.dirty !== prev.dirty ||
        s.filePath !== prev.filePath ||
        s.project.meta.title !== prev.project.meta.title
      )
        pushState();
    });
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!api.isElectron && useProject.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      disposed = true;
      offs.forEach((off) => off());
      unsub();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <TrackList />
        <main className="editor">
          <PianoRoll />
        </main>
      </div>
      {showController ? <ControllerPanel /> : <div />}
      <StatusBar />
      {dialog === 'export' && <SheetExportDialog />}
      {dialog === 'midi' && <MidiSettingsDialog />}
      {dialog === 'prefs' && <PreferencesDialog />}
      {dialog === 'quantize' && <QuantizeDialog />}
      {dialog === 'projectInfo' && <ProjectInfoDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      {dialog === 'about' && <AboutDialog />}
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
