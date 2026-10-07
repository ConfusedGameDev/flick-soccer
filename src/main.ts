import './style.css';
import { Application } from 'pixi.js';
import { initialMatch } from './engine/setup';
import { LocalController } from './game/controller';
import { Match } from './game/Match';
import { FlickGesture } from './input/FlickGesture';
import { PiecesView } from './render/PiecesView';
import { PitchView } from './render/PitchView';
import { PlanPreview } from './render/PlanPreview';
import { TimelinePlayer } from './render/TimelinePlayer';
import { DiceView } from './ui/DiceView';
import { Duel } from './ui/Duel';
import { Hud } from './ui/Hud';

async function boot(): Promise<void> {
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
  const hud = new Hud(overlay);
  const duel = new Duel(overlay);
  const dice = new DiceView(overlay);
  const pitch = new PitchView();
  const preview = new PlanPreview(pitch);

  // The discs only need the fixed team/number layout, which initialMatch() always gives.
  const pieces = new PiecesView(pitch, initialMatch().players);
  let match: Match;
  const player = new TimelinePlayer(
    (players, ball) => pieces.setPositions(players, ball),
    (e) => match.onEvent(e),
  );
  const local = new LocalController({ hud, preview, pieces, dice, rollSeed: (s, team) => match.rollSeed(s, team) });
  match = new Match({ hud, duel, dice, pieces, preview, player, local });
  const gesture = new FlickGesture(app.canvas, pitch, local.handlers);
  local.attachGesture(gesture);

  app.stage.addChild(pitch.root, pieces.root, preview.root);

  const layout = () => {
    pitch.layout(app.screen.width, app.screen.height);
    pieces.redraw(match.state.players);
    if (!player.playing) {
      pieces.setPositions(
        match.state.players.map((p) => p.pos),
        match.state.ball,
      );
    }
  };
  app.renderer.on('resize', layout);
  layout();

  app.ticker.add((t) => match.update(Math.min(0.1, t.deltaMS / 1000)));

  if (import.meta.env.DEV) (window as unknown as { __match: Match }).__match = match;

  await match.start();
}

boot().catch((err) => {
  console.error(err);
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = `<div class="cover"><h1>Oops</h1><p>${String(err)}</p></div>`;
});
