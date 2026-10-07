import './style.css';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Application } from 'pixi.js';
import { Sfx } from './audio/Sfx';
import poolData from './data/players.json';
import type { PoolPlayer } from './engine/pool';
import { initialMatch } from './engine/setup';
import { LocalController } from './game/controller';
import { Match } from './game/Match';
import { OnlineMatch } from './game/OnlineMatch';
import { TeamBuilder } from './game/TeamBuilder';
import { FlickGesture } from './input/FlickGesture';
import { PiecesView } from './render/PiecesView';
import { PitchView } from './render/PitchView';
import { PlanPreview } from './render/PlanPreview';
import { TimelinePlayer } from './render/TimelinePlayer';
import { Cutscene } from './ui/Cutscene';
import { DiceView } from './ui/DiceView';
import { Duel } from './ui/Duel';
import { Hud } from './ui/Hud';
import { KitEditor } from './ui/KitEditor';

/** Native-only niceties: dark status bar over the pitch. Nothing here matters on the web. */
async function nativeSetup(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === 'android') await StatusBar.setBackgroundColor({ color: '#0d2416' });
  } catch {
    /* plugin missing or unsupported: ignore */
  }
}

async function boot(): Promise<void> {
  void nativeSetup();
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#0d2416',
    antialias: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  document.getElementById('game')!.appendChild(app.canvas);

  const overlay = document.getElementById('overlay')!;
  const sfx = new Sfx();
  const hud = new Hud(overlay);
  hud.setMuted(sfx.muted);
  hud.onMute = () => {
    sfx.setMuted(!sfx.muted);
    hud.setMuted(sfx.muted);
  };
  // Every UI button blips.
  overlay.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) sfx.click();
  });
  const duel = new Duel(overlay, { whistle: () => sfx.whistle(), countdown: (n) => sfx.countdown(n), mash: () => sfx.mash() });
  const dice = new DiceView(overlay, () => sfx.dice());
  const cutscene = new Cutscene(overlay);
  const kitEditor = new KitEditor(overlay);
  const pitch = new PitchView();
  const preview = new PlanPreview(pitch);
  const pool = poolData as PoolPlayer[];

  // The discs are rebuilt whenever squads change; start with the baseline layout.
  const pieces = new PiecesView(pitch, initialMatch().players);
  let match: Match;
  let online: OnlineMatch;
  const player = new TimelinePlayer(
    (players, ball) => pieces.setPositions(players, ball),
    (e) => (match.phase === 'ONLINE' ? online.onEvent(e) : match.onEvent(e)),
  );
  const local = new LocalController({ hud, preview, pieces, dice });
  const layout = () => {
    pitch.layout(app.screen.width, app.screen.height);
    pieces.redraw();
    if (!player.playing && match.phase !== 'BUILD') {
      pieces.setPositions(
        match.state.players.map((p) => p.pos),
        match.state.ball,
      );
    }
  };
  const builder = new TeamBuilder({ hud, pitch, pieces, canvas: app.canvas, overlay, relayout: layout });
  match = new Match({ hud, duel, dice, builder, pool, pieces, preview, player, local, sfx, cutscene, kitEditor });
  // Match server: VITE_SERVER_URL overrides; dev talks to `npm run server:dev`, production to Fly.
  const serverUrl = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? (import.meta.env.DEV ? 'ws://localhost:8787' : 'wss://flick-soccer-match.fly.dev');
  online = new OnlineMatch({ serverUrl, hud, duel, dice, cutscene, sfx, builder, pool, pieces, preview, player, local, pickKit: () => match.chooseKit('home', new Set(), 'Pick your kit') });
  match.online = online;
  const gesture = new FlickGesture(app.canvas, pitch, local.handlers);
  local.attachGesture(gesture);

  app.stage.addChild(pitch.root, pieces.root, preview.root);
  app.renderer.on('resize', layout);
  layout();

  app.ticker.add((t) => {
    const dt = Math.min(0.1, t.deltaMS / 1000);
    match.update(dt);
    pieces.tick(dt);
  });

  if (import.meta.env.DEV) (window as unknown as { __match: Match }).__match = match;

  await match.start();
}

boot().catch((err) => {
  console.error(err);
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = `<div class="cover"><h1>Oops</h1><p>${String(err)}</p></div>`;
});
