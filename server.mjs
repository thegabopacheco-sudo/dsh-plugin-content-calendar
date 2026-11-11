#!/usr/bin/env node
// dsh-plugin-content-calendar — calendario de contenido local para DeepSeek Harness.
// Tools: status, list, add, update, due, mark_published, remove.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const DATA_DIR = path.join(DSH_HOME, 'content-calendar');
const DATA_FILE = path.join(DATA_DIR, 'calendar.json');
const AUDIT_FILE = path.join(DSH_HOME, 'cache', 'content-calendar', 'audit.jsonl');
const READ_ONLY = String(process.env.DSH_CALENDAR_MODE || '').toLowerCase() === 'read-only';
const WRITE_LIMIT = 20;
const WRITE_WINDOW_MS = 60_000;
const CHANNELS = ['discord', 'web', 'tiktok', 'youtube', 'instagram', 'twitter', 'email', 'otro'];
const log = (m) => process.stderr.write(`[calendar] ${m}\n`);

function audit(entry) {
  try { mkdirSync(path.dirname(AUDIT_FILE), { recursive: true }); appendFileSync(AUDIT_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'); } catch { /* best effort */ }
}

function loadData() {
  try {
    if (existsSync(DATA_FILE)) {
      const data = JSON.parse(readFileSync(DATA_FILE, 'utf8')) || {};
      return { posts: Array.isArray(data.posts) ? data.posts : [], updatedAt: data.updatedAt || null };
    }
  } catch (error) { log(`datos inválidos: ${error.message}`); }
  return { posts: [], updatedAt: null };
}
function saveData(data) {
  mkdirSync(DATA_DIR, { recursive: true });
  data.updatedAt = new Date().toISOString();
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}
const writes = [];
function checkRate() {
  const now = Date.now();
  while (writes.length && now - writes[0] > WRITE_WINDOW_MS) writes.shift();
  if (writes.length >= WRITE_LIMIT) throw new Error(`límite de escrituras (${WRITE_LIMIT}/minuto)`);
  writes.push(now);
}

function parseWhen(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('scheduledAt obligatorio');
  const isoLike = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(raw) ? raw.replace(' ', 'T') : raw;
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) throw new Error(`fecha inválida: ${raw} (usa ISO 8601 o YYYY-MM-DD HH:MM)`);
  return date.toISOString();
}

function normalizePost(input, existing = null) {
  const post = existing ? { ...existing } : { id: randomUUID().slice(0, 8), createdAt: new Date().toISOString(), status: 'planned', publishedAt: null };
  if (input.title !== undefined) {
    const title = String(input.title).trim();
    if (!title || title.length > 120) throw new Error('title obligatorio (1-120 caracteres)');
    post.title = title;
  }
  if (input.content !== undefined) {
    if (String(input.content).length > 4000) throw new Error('content máximo 4000 caracteres');
    post.content = String(input.content);
  }
  if (input.channel !== undefined) {
    const channel = String(input.channel).toLowerCase().trim();
    if (!CHANNELS.includes(channel)) throw new Error(`channel inválido: ${channel}. Opciones: ${CHANNELS.join(', ')}`);
    post.channel = channel;
  }
  if (input.scheduledAt !== undefined) post.scheduledAt = parseWhen(input.scheduledAt);
  if (input.tags !== undefined) post.tags = Array.isArray(input.tags) ? input.tags.slice(0, 10).map(String) : [];
  if (input.notes !== undefined) post.notes = String(input.notes).slice(0, 1000);
  if (input.status !== undefined) {
    if (!['planned', 'published', 'skipped'].includes(input.status)) throw new Error('status inválido');
    post.status = input.status;
    if (input.status === 'published' && !post.publishedAt) post.publishedAt = new Date().toISOString();
    if (input.status === 'planned') post.publishedAt = null;
  }
  for (const key of ['title', 'channel', 'scheduledAt']) if (!post[key]) throw new Error(`${key} obligatorio`);
  return post;
}

function sortPosts(posts) { return [...posts].sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))); }
function line(post) { return `[${post.status}] ${post.id} · ${post.scheduledAt}\n   ${post.channel}: ${post.title}${post.tags?.length ? ` (tags: ${post.tags.join(', ')})` : ''}`; }
function textResult(t) { return { content: [{ type: 'text', text: t }] }; }

function buildInstructions() {
  return [
    'Content Calendar: calendario local de contenido para WENDIGO.',
    '',
    `Datos: ${DATA_FILE}`,
    '',
    'Herramientas: status, list, add, update, due, mark_published, remove.',
    '',
    'Reglas:',
    '- Toda escritura requiere confirm:true y pedido explícito del usuario.',
    '- Usa fechas ISO 8601 o YYYY-MM-DD HH:MM (hora local).',
    '- due muestra lo que toca publicar; mark_published lo marca como hecho (no publica nada por sí solo).',
    '- Canales: ' + CHANNELS.join(', ') + '.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-content-calendar', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });

  server.registerTool(
    'status',
    { title: 'Estado', description: 'Resumen del calendario: pendientes, publicados y próximo post.', inputSchema: z.object({}) },
    async () => {
      const data = loadData();
      const planned = data.posts.filter((p) => p.status === 'planned').sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
      const published = data.posts.filter((p) => p.status === 'published').length;
      return textResult([
        `Modo: ${READ_ONLY ? 'read-only' : 'normal'}`,
        `Datos: ${DATA_FILE}`,
        `Posts: ${data.posts.length} · planificados: ${planned.length} · publicados: ${published}`,
        `Próximo: ${planned[0] ? `${planned[0].scheduledAt} · ${planned[0].channel}: ${planned[0].title}` : '(ninguno)'}`,
      ].join('\n'));
    },
  );

  server.registerTool(
    'list',
    {
      title: 'Listar posts',
      description: 'Lista publicaciones filtradas por estado, canal o rango de fechas.',
      inputSchema: z.object({
        status: z.enum(['planned', 'published', 'skipped']).optional(),
        channel: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
    async (args) => {
      let posts = sortPosts(loadData().posts);
      if (args.status) posts = posts.filter((p) => p.status === args.status);
      if (args.channel) posts = posts.filter((p) => p.channel === args.channel.toLowerCase());
      if (args.from) { const from = parseWhen(args.from); posts = posts.filter((p) => p.scheduledAt >= from); }
      if (args.to) { const to = parseWhen(args.to); posts = posts.filter((p) => p.scheduledAt <= to); }
      posts = posts.slice(0, args.limit ?? 50);
      if (posts.length === 0) return textResult('Sin publicaciones que coincidan.');
      return textResult(posts.map(line).join('\n\n'));
    },
  );

  server.registerTool(
    'add',
    {
      title: 'Agregar publicación',
      description: 'Agrega una publicación al calendario. Requiere confirm:true.',
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        channel: z.enum(CHANNELS),
        scheduledAt: z.string().min(4),
        content: z.string().max(4000).optional(),
        tags: z.array(z.string()).max(10).optional(),
        notes: z.string().max(1000).optional(),
        confirm: z.boolean().optional(),
      }),
    },
    async (args) => {
      if (READ_ONLY) throw new Error('modo read-only: add deshabilitado');
      if (args.confirm !== true) throw new Error('add requiere confirm:true y confirmación explícita');
      checkRate();
      const data = loadData();
      const post = normalizePost(args);
      data.posts.push(post);
      saveData(data);
      audit({ tool: 'add', id: post.id, channel: post.channel, ok: true });
      return textResult(`Publicación agregada: ${post.id} · ${post.scheduledAt} · ${post.channel}: ${post.title}`);
    },
  );

  server.registerTool(
    'update',
    {
      title: 'Editar publicación',
      description: 'Actualiza campos de una publicación. Requiere confirm:true.',
      inputSchema: z.object({
        id: z.string().min(1),
        title: z.string().min(1).max(120).optional(),
        channel: z.enum(CHANNELS).optional(),
        scheduledAt: z.string().optional(),
        content: z.string().max(4000).optional(),
        tags: z.array(z.string()).max(10).optional(),
        notes: z.string().max(1000).optional(),
        confirm: z.boolean().optional(),
      }),
    },
    async (args) => {
      if (READ_ONLY) throw new Error('modo read-only: update deshabilitado');
      if (args.confirm !== true) throw new Error('update requiere confirm:true');
      checkRate();
      const data = loadData();
      const index = data.posts.findIndex((p) => p.id === args.id);
      if (index < 0) throw new Error(`publicación no encontrada: ${args.id}`);
      data.posts[index] = normalizePost(args, data.posts[index]);
      saveData(data);
      audit({ tool: 'update', id: args.id, ok: true });
      return textResult(`Publicación actualizada: ${args.id} · ${data.posts[index].scheduledAt} · ${data.posts[index].channel}: ${data.posts[index].title}`);
    },
  );

  server.registerTool(
    'due',
    {
      title: 'Pendientes de publicar',
      description: 'Muestra lo que vence en las próximas N horas (default 24).',
      inputSchema: z.object({ withinHours: z.number().int().min(0).max(720).optional() }),
    },
    async (args) => {
      const hours = args.withinHours ?? 24;
      const limit = new Date(Date.now() + hours * 3600_000).toISOString();
      const now = new Date().toISOString();
      const posts = sortPosts(loadData().posts).filter((p) => p.status === 'planned' && p.scheduledAt <= limit);
      if (posts.length === 0) return textResult(`Nada programado en las próximas ${hours} h.`);
      return textResult(`Pendientes en ${hours} h (${posts.length}):\n\n` + posts.map((p) => `${line(p)}${p.scheduledAt < now ? ' ⚠️ atrasado' : ''}`).join('\n\n'));
    },
  );

  server.registerTool(
    'mark_published',
    {
      title: 'Marcar como publicado',
      description: 'Marca una publicación como publicada. Requiere confirm:true.',
      inputSchema: z.object({ id: z.string().min(1), confirm: z.boolean().optional() }),
    },
    async (args) => {
      if (READ_ONLY) throw new Error('modo read-only: mark_published deshabilitado');
      if (args.confirm !== true) throw new Error('mark_published requiere confirm:true');
      checkRate();
      const data = loadData();
      const post = data.posts.find((p) => p.id === args.id);
      if (!post) throw new Error(`publicación no encontrada: ${args.id}`);
      post.status = 'published';
      post.publishedAt = new Date().toISOString();
      saveData(data);
      audit({ tool: 'mark_published', id: post.id, ok: true });
      return textResult(`Publicación ${post.id} marcada como publicada.`);
    },
  );

  server.registerTool(
    'remove',
    {
      title: 'Eliminar publicación',
      description: 'Elimina una publicación. Requiere confirm:true.',
      inputSchema: z.object({ id: z.string().min(1), confirm: z.boolean().optional() }),
    },
    async (args) => {
      if (READ_ONLY) throw new Error('modo read-only: remove deshabilitado');
      if (args.confirm !== true) throw new Error('remove requiere confirm:true');
      checkRate();
      const data = loadData();
      const before = data.posts.length;
      data.posts = data.posts.filter((p) => p.id !== args.id);
      if (data.posts.length === before) throw new Error(`publicación no encontrada: ${args.id}`);
      saveData(data);
      audit({ tool: 'remove', id: args.id, ok: true });
      return textResult(`Publicación ${args.id} eliminada.`);
    },
  );

  return server;
}

try {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) saveData({ posts: [] });
} catch (e) { log(`init: ${e.message}`); }
log(`modo ${READ_ONLY ? 'read-only' : 'normal'} · datos: ${DATA_FILE}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
