import './style.css';
import { App } from '@capacitor/app';
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
import { Coach } from './ui/Coach';
import { Cutscene } from './ui/Cutscene';
import { DiceView } from './ui/DiceView';
import { Duel } from './ui/Duel';
import { Hud } from './ui/Hud';
import { KitEditor } from './ui/KitEditor';
import { SetPiece } from './ui/SetPiece';
import { Store } from './ui/Store';
import { applyScreens, onSegmentsChange, readScreens } from './ui/segments';

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

/**
 * Silence the game while it is in the background. The page's visibility
 * covers browsers and iOS; the Android WebView does not reliably report it
 * when the activity pauses, so the App plugin's state change is wired too.
 */
function lifecycle(sfx: Sfx): void {
  document.addEventListener('visibilitychange', () => (document.hidden ? sfx.suspend() : sfx.resume()));
  if (!Capacitor.isNativePlatform()) return;
  try {
    void App.addListener('appStateChange', ({ isActive }) => (isActive ? sfx.resume() : sfx.suspend()));
  } catch {
    /* plugin missing: the visibility listener still applies */
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
  lifecycle(sfx);
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
  const dice = new DiceView(overlay, () => sfx.dice(), () => sfx.kick(0.8));
  const setPiece = new SetPiece(overlay, { tick: () => sfx.click(), kick: () => sfx.kick(1) });
  const cutscene = new Cutscene(overlay);
  const coach = new Coach(overlay);
  const store = new Store(overlay);
  const kitEditor = new KitEditor(overlay, document.getElementById('stage'));
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
  const local = new LocalController({ hud, preview, pieces, dice, setPiece });
  const layout = () => {
    // Dual-screen (M9): the HUD overlay is pinned to the pane screen by CSS; the pitch takes the other.
    const screens = applyScreens(readScreens());
    pitch.screen = screens.posture === 'single' ? null : screens.pitch;
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
  match = new Match({ hud, duel, dice, builder, pool, pieces, preview, player, local, sfx, cutscene, kitEditor, coach, store });
  // Match server: VITE_SERVER_URL overrides; dev talks to `npm run server:dev`, production to Fly.
  const serverUrl = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? (import.meta.env.DEV ? 'ws://localhost:8787' : 'wss://flick-soccer-match.fly.dev');
  online = new OnlineMatch({ serverUrl, hud, duel, dice, cutscene, sfx, builder, pool, pieces, preview, player, local, pickKit: () => match.chooseKit('home', new Set(), 'Pick your kit') });
  match.online = online;
  const gesture = new FlickGesture(app.canvas, pitch, local.handlers);
  local.attachGesture(gesture);

  app.stage.addChild(pitch.root, pieces.root, preview.root);
  app.renderer.on('resize', layout);
  onSegmentsChange(layout);
  layout();

  app.ticker.add((t) => {
    const dt = Math.min(0.1, t.deltaMS / 1000);
    match.update(dt);
    pieces.tick(dt);
  });

  if (import.meta.env.DEV) (window as unknown as { __match: Match }).__match = match;

  // Art previews (`?demo=sheet|cutscenes|shot`), see ui/demo.ts; loaded on demand so they cost nothing otherwise.
  const demo = new URLSearchParams(location.search).get('demo');
  if (demo) {
    const { runDemo } = await import('./ui/demo');
    await runDemo(demo, { overlay, cutscene, setPiece, pieces, player });
    return;
  }
  await match.start();
}

boot().catch((err) => {
  console.error(err);
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = `<div class="cover"><h1>Oops</h1><p>${String(err)}</p></div>`;
});
