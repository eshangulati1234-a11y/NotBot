export interface RuntimeConnection {
  configured: boolean;
  managed: boolean;
}
export interface RuntimeEvent {
  seq: number;
  run_id: string | null;
  kind: string;
  data: Record<string, unknown>;
  created: number;
}
export interface RuntimeAPI {
  connection(): Promise<RuntimeConnection>;
  request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<unknown>;
  subscribe(
    after: number,
    listener: (event: RuntimeEvent) => void,
    onError: (message: string) => void,
  ): () => void;
  chooseWorkspace(): Promise<string | null>;
  saveArtifact(id: string): Promise<boolean>;
}
declare global {
  interface Window {
    notbotRuntime?: RuntimeAPI;
  }
}
