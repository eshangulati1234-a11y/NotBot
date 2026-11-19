import { contextBridge, ipcRenderer } from 'electron';
import type { RuntimeAPI, RuntimeEvent } from '../shared/runtime';
const runtime: RuntimeAPI = {
  connection: () => ipcRenderer.invoke('runtime:connection'),
  request: (method, path, body, key) =>
    ipcRenderer.invoke('runtime:request', method, path, body, key),
  chooseWorkspace: () => ipcRenderer.invoke('runtime:workspace'),
  saveArtifact: (id) => ipcRenderer.invoke('runtime:save-artifact', id),
  subscribe: (after, listener, onError) => {
    const receive = (_event: Electron.IpcRendererEvent, value: RuntimeEvent) => listener(value);
    const error = (_event: Electron.IpcRendererEvent, message: string) => onError(message);
    ipcRenderer.on('runtime:event', receive);
    ipcRenderer.on('runtime:event-error', error);
    void ipcRenderer
      .invoke('runtime:events:start', after)
      .catch((reason) => onError(String(reason)));
    return () => {
      ipcRenderer.removeListener('runtime:event', receive);
      ipcRenderer.removeListener('runtime:event-error', error);
      void ipcRenderer.invoke('runtime:events:stop').catch(() => {});
    };
  },
};
contextBridge.exposeInMainWorld('notbotRuntime', runtime);
