import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function run(args) {
  const result = spawnSync('uv', args, { stdio: 'inherit', cwd: resolve('.') });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(['sync', '--directory', 'harness', '--locked']);
run([
  'run',
  '--directory',
  'harness',
  'pyinstaller',
  '--noconfirm',
  '--clean',
  '--onedir',
  '--name',
  'notbot-harness',
  '--distpath',
  resolve('dist/harness'),
  '--workpath',
  resolve('dist/harness-build'),
  '--specpath',
  resolve('dist/harness-build'),
  '--paths',
  resolve('harness'),
  '--collect-submodules',
  'langgraph',
  '--collect-submodules',
  'langchain_openai',
  '--collect-submodules',
  'tiktoken_ext',
  '--recursive-copy-metadata',
  'langchain',
  '--recursive-copy-metadata',
  'langgraph',
  '--recursive-copy-metadata',
  'langgraph-checkpoint-sqlite',
  '--recursive-copy-metadata',
  'langchain-openai',
  '--hidden-import',
  'uvicorn.logging',
  '--hidden-import',
  'uvicorn.loops.auto',
  '--hidden-import',
  'uvicorn.protocols.http.h11_impl',
  '--hidden-import',
  'uvicorn.protocols.websockets.auto',
  '--hidden-import',
  'uvicorn.lifespan.on',
  resolve('harness/desktop_entry.py'),
]);
