// Test end-to-end de content-calendar (local, sin red).
import path from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(path.join(tmpDir, 'dsh-home'), { recursive: true });

function makeClient(extraEnv = {}) {
  const entry = process.env.CALENDAR_SERVER ? path.resolve(process.env.CALENDAR_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: path.join(tmpDir, 'dsh-home'), ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'calendar-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
const soon = new Date(Date.now() + 3600_000).toISOString();
const later = new Date(Date.now() + 5 * 86400_000).toISOString();

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const noConfirm = await client.callTool({ name: 'add', arguments: { title: 'x', channel: 'discord', scheduledAt: soon } });
console.log('add sin confirm isError:', noConfirm.isError === true);
const a = await client.callTool({ name: 'add', arguments: { title: 'Anuncio de mantenimiento', channel: 'discord', scheduledAt: soon, content: 'Mantenimiento mañana', tags: ['aviso'], confirm: true } });
console.log('--- add A ---'); console.log(textOf(a));
const idA = (textOf(a).match(/\(?([a-z0-9]{8}) ·/i) || [])[1];
const b = await client.callTool({ name: 'add', arguments: { title: 'Short de WENDIGO', channel: 'tiktok', scheduledAt: later, confirm: true } });
console.log('--- add B ---'); console.log(textOf(b));
const idB = (textOf(b).match(/\(?([a-z0-9]{8}) ·/i) || [])[1];
console.log('--- list ---'); console.log(textOf(await client.callTool({ name: 'list', arguments: {} })));
console.log('--- due 24h ---'); console.log(textOf(await client.callTool({ name: 'due', arguments: { withinHours: 24 } })));
const upd = await client.callTool({ name: 'update', arguments: { id: idA, title: 'Anuncio actualizado', confirm: true } });
console.log('--- update ---'); console.log(textOf(upd));
const pub = await client.callTool({ name: 'mark_published', arguments: { id: idA, confirm: true } });
console.log('--- mark_published ---'); console.log(textOf(pub));
console.log('--- list published ---'); console.log(textOf(await client.callTool({ name: 'list', arguments: { status: 'published' } })));
const rem = await client.callTool({ name: 'remove', arguments: { id: idB, confirm: true } });
console.log('--- remove ---'); console.log(textOf(rem));
const channelBad = await client.callTool({ name: 'add', arguments: { title: 'x', channel: 'myspace', scheduledAt: soon, confirm: true } });
console.log('canal inválido isError:', channelBad.isError === true);
console.log('--- status final ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
await client.close(); try { await transport.close?.(); } catch {}
const { client: roClient, transport: roTransport } = await makeClient({ DSH_CALENDAR_MODE: 'read-only' });
const roAdd = await roClient.callTool({ name: 'add', arguments: { title: 'x', channel: 'discord', scheduledAt: soon, confirm: true } });
console.log('read-only add isError:', roAdd.isError === true);
const roList = await roClient.callTool({ name: 'list', arguments: {} });
console.log('read-only list permitido:', roList.isError !== true);
await roClient.close(); try { await roTransport.close?.(); } catch {}
console.log('OK');
